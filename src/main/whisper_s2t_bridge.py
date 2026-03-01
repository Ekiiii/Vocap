import sys
import json
import argparse
import os

# V110: Sandbox environment variables leaking from Electron's frontend ONNX config.
# If these bleed into Python's onnxruntime, it crashes instantly on non-DML packages.
os.environ.pop('ONNXRUNTIME_EXECUTION_PROVIDERS', None)
os.environ.pop('ORT_DIRECTML_DEVICE_ID', None)

# V103: Monkeypatch tqdm to emit progress JSON for index.ts
try:
    import tqdm
    _orig_tqdm = tqdm.tqdm
    class PatchedTqdm(_orig_tqdm):
        def update(self, n=1):
            super().update(n)
            pct = 0
            if self.total and self.total > 0:
                pct = int((self.n / self.total) * 100)
            print(json.dumps({'status': 'transcribing', 'progress': pct}), flush=True)
    tqdm.tqdm = PatchedTqdm
except Exception as e:
    pass

try:
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
    os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"
except ImportError:
    pass

import whisper_s2t

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--lang", default="fr")
    args = parser.parse_args()

    # V100: Normalize language codes to ISO 639-1 (Whisper requirement)
    # Fixes KeyError: 'french'
    lang_map = {
        "french": "fr",
        "english": "en",
        "spanish": "es",
        "german": "de",
        "italian": "it",
        "japanese": "ja",
        "chinese": "zh",
        "portuguese": "pt",
        "russian": "ru",
    }
    args.lang = lang_map.get(args.lang.lower(), args.lang)

    # Map model name or use direct HF path for Turbo
    # whisper-s2t strict list: tiny, base, small, medium, large-v1, large-v2, large-v3, large
    # V96: Bypass validation by using a direct HuggingFace path for the actual 'turbo' weights
    model_name = args.model
    n_mels = 80
    if model_name in ["turbo", "large-v3-turbo"]:
        model_name = "deepdml/faster-whisper-large-v3-turbo-ct2"
        n_mels = 128
    elif model_name in ["large", "large-v3"]:
        model_name = "large-v3"
        n_mels = 128
    
    import os
    if not os.path.exists(args.audio):
        print(json.dumps({'success': False, 'error': f"Audio file not found: {args.audio}"}))
        sys.exit(1)
        
    file_size = os.path.getsize(args.audio)
    if file_size < 100:
        print(json.dumps({'success': False, 'error': f"Audio file is too small or empty ({file_size} bytes)"}))
        sys.exit(1)

    # V97: Monkeypatch WhisperS2T bug (merge_chunks=False missing metadata for aligner)
    import whisper_s2t.data
    _orig_get_seg = whisper_s2t.data.WhisperDataLoader.get_segmented_audio_signal
    def _patched_get_seg(self, start_ends, audio_signal, file_id, lang, task, initial_prompt, sr=16000):
        segments = _orig_get_seg(self, start_ends, audio_signal, file_id, lang, task, initial_prompt, sr)
        for seg in segments:
            if len(seg) >= 5 and isinstance(seg[4], dict):
                if 'lang_code' not in seg[4]: seg[4]['lang_code'] = lang
                if 'stitched_seg' not in seg[4]: seg[4]['stitched_seg'] = [[seg[4]['start_time'], seg[4]['end_time']]]
        return segments
    whisper_s2t.data.WhisperDataLoader.get_segmented_audio_signal = _patched_get_seg

    try:
        print(f"DEBUG: Initializing model {model_name} (n_mels={n_mels})", file=sys.stderr)
        import torch
        device_type = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"DEBUG: Selected device computation type: {device_type}", file=sys.stderr)

        # Reusable model loading arguments
        load_kwargs = dict(
            model_identifier=model_name,
            backend='ctranslate2',
            device=device_type,
            compute_type='float16' if device_type == 'cuda' else 'int8',
            n_mels=n_mels,
            without_timestamps=False,
            merge_chunks=False, # We want word-level precision for UI rendering, not massive blocks
            dta_padding=3.0,
            asr_options={
                'word_timestamps': True,
                'word_aligner_model': 'large-v3' if n_mels == 128 else 'tiny',
                'beam_size': 5,
                'repetition_penalty': 1.0, 
                'no_repeat_ngram_size': 0,
                'condition_on_previous_text': False,
                'log_prob_threshold': -1.5,
                'no_speech_threshold': 0.8,
                'temperatures': [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            },
            speech_segmenter_options={
                'max_silent_region': 0.8,
                'padding': 0.3,
                'max_seg_len': 30.0,
                'min_seg_len': 0.1
            }
        )

        try:
            model = whisper_s2t.load_model(**load_kwargs)
        except Exception as hardware_err:
            if device_type == 'cuda':
                print(f"WARNING: CUDA Initialization failed (Missing DLLs?). Falling back to CPU. ({hardware_err})", file=sys.stderr)
                load_kwargs['device'] = 'cpu'
                load_kwargs['compute_type'] = 'int8'
                model = whisper_s2t.load_model(**load_kwargs)
            else:
                raise hardware_err

        print(f"DEBUG: Starting transcription with VAD (audio={args.audio})", file=sys.stderr)
        results = model.transcribe_with_vad(
            [args.audio],
            lang_codes=[args.lang],
            tasks=['transcribe'],
            batch_size=1
        )
        print(f"DEBUG: Transcription complete. Segments={len(results[0])}", file=sys.stderr)

        def get_val(obj, key, default=None):
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        final_output = []
        for segment in results[0]:
            chunk_text = get_val(segment, 'text', '').strip()
            
            # V117: Restored hallucination filters. We discovered that Audio Separation 
            # (Kim Vocal 2, etc.) can completely erase certain phrases it thinks are noise. 
            # When Whisper receives this absolute silence, it natively hallucinates TV credits. 
            # We MUST filter these out so the UI isn't polluted with "Sous-titrage Société Radio-Canada".
            hallucinations = [
                "communauté", "amara.org", "sous-titr", "transcription", 
                "merci", "visionnage", "regarder", "traduction", "st'", 
                "st501", "sous-titre", "st ", "radio-canada", "tv", "télévision"
            ]
            
            if any(h in chunk_text.lower() for h in hallucinations):
                # Filter out short meta-text chunks (usually credits or junk)
                if len(chunk_text.split()) < 20: # Increased limit to catch longer credit hallucinations
                    continue
            
            # Robust timestamp detection for segments
            # CTranslate2 objects often use .start and .end directly
            start = get_val(segment, 'start', get_val(segment, 'start_time', -1.0))
            end = get_val(segment, 'end', get_val(segment, 'end_time', -1.0))
            
            if start == -1.0: start = 0.0
            
            words = []
            # CTranslate2 words are often in .words
            word_array = get_val(segment, 'words', get_val(segment, 'word_timestamps', []))

            for w in word_array:
                w_start = get_val(w, 'start', get_val(w, 'start_time', start))
                w_end = get_val(w, 'end', get_val(w, 'end_time', end))
                w_text = get_val(w, 'word', get_val(w, 'text', '')).strip()
                
                if not w_text:
                    continue

                words.append({
                    'word': w_text,
                    'start': w_start,
                    'end': w_end,
                    'probability': get_val(w, 'prob', get_val(w, 'probability', 1.0))
                })
            
            if not words and not chunk_text:
                continue

            final_output.append({
                'text': chunk_text,
                'timestamp': [start, end],
                'words': words
            })

        # V112: Disabled end-of-file artifact check to prevent accidentally popping valid final sentences
        # if len(final_output) > 1:
        #     last_text = final_output[-1]['text'].lower()
        #     if any(h in last_text for h in ["merci", "visionnage", "communauté"]):
        #         final_output.pop()

        print(f"WHISPER_S2T_RESULT:{json.dumps({'success': True, 'chunks': final_output})}")

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
