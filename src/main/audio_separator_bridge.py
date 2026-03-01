import sys
import json
import argparse
import os
import logging

# V110: Sandbox environment variables leaking from Electron's frontend ONNX config.
# If these bleed into Python's onnxruntime, it crashes instantly on non-DML packages.
os.environ.pop('ONNXRUNTIME_EXECUTION_PROVIDERS', None)
os.environ.pop('ORT_DIRECTML_DEVICE_ID', None)

# Disable unnecessary logging from sub-libraries
logging.getLogger("onnxruntime").setLevel(logging.ERROR)

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
            print(json.dumps({'status': 'separating', 'progress': pct}), flush=True)
    tqdm.tqdm = PatchedTqdm
except Exception as e:
    pass

# V103b: Inject FFmpeg into PATH for audio-separator subprocesses
try:
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
    os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"
except ImportError:
    pass

try:
    from audio_separator.separator import Separator
    # V104: Bypass the strict ffmpeg/ffprobe checks since we rely on soundfile
    Separator.check_ffmpeg_installed = lambda self: None
except ImportError:
    print(json.dumps({'success': False, 'error': "audio-separator not installed. Please install dependencies."}))
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to input audio/video file")
    parser.add_argument("--output_dir", required=True, help="Directory to save separated files")
    parser.add_argument("--model", default="MelRoformer", help="Model name or file")
    parser.add_argument("--stem", default="Vocals", choices=["Vocals", "Instrumental"], help="Stem to extract")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({'success': False, 'error': f"Input file not found: {args.input}"}))
        sys.exit(1)

    if not os.path.exists(args.output_dir):
        os.makedirs(args.output_dir, exist_ok=True)

    try:
        # Initialize Separator
        # Default model for Mel-Band Roformer in audio-separator is typically a specific ID.
        # If the user provides a custom one, we use it.
        # GaboxR67 V7 might be 'mel_band_roformer_gabox_vocals_v1' or similar in newer versions.
        # If model is "MelRoformer", we try a high quality default or the closest match.
        
        model_id = args.model
        if model_id == "MelRoformer":
            # Kim_Vocal_2.onnx is an MDX-Net model that is MUCH faster than Roformer
            # and very effective at isolating vocals for speech recognition.
            model_id = "Kim_Vocal_2.onnx"
        
        print(json.dumps({'status': 'loading_model'}), flush=True)

        # GPU Detection for audio-separator
        use_directml = False
        
        # Simple check for AMD/Intel via powershell as in install script
        try:
            import subprocess
            # V103: Wrap in explicit try-except capturing generic Exception to avoid WinError 2 crash
            res = subprocess.run(['powershell.exe', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'], capture_output=True, text=True, check=False)
            gpu_name = res.stdout.lower()
            if 'amd' in gpu_name or 'radeon' in gpu_name or 'intel' in gpu_name:
                use_directml = True
        except Exception as e:
            # Fallback to default audio-separator logic silently
            pass

        # V120: audio-separator has a massive strictness bug on Windows. 
        # Inside `Separator.setup_accelerated_inferencing_device()`, it calls `self.check_ffmpeg_installed()`.
        # Because we ship our own ffmpeg via `ffmpeg-static` in Node.js instead of system PATH, 
        # this call crashes with `FileNotFoundError`, causing the GPU initialization to abort and SILENTLY 
        # fall back to CPU! We MUST monkeypatch `Separator.check_ffmpeg_installed` globally before init.
        Separator.check_ffmpeg_installed = lambda self: None

        separator = Separator(
            output_dir=args.output_dir,
            output_format="WAV",
            use_directml=use_directml,
            use_soundfile=True # V104: Bypass ffmpeg/ffprobe dependency for audio chunking
        )

        print(json.dumps({'status': 'loading_model', 'message': f"Loading model {model_id}..."}))
        try:
            # Recent versions of audio-separator might use different method names
            # or parameters. load_model(model_name) is standard.
            separator.load_model(model_id)
        except Exception as load_err:
            raise Exception(f"Failed to load model '{model_id}'. Error: {str(load_err)}")

        print(json.dumps({'status': 'separating', 'message': "Separating audio stems..."}))
        output_files = separator.separate(args.input)

        # audio-separator returns a list of output filenames
        # We find the file matching the requested stem
        target_file = next((f for f in output_files if args.stem.lower() in f.lower()), None)
        
        if target_file:
            full_path = os.path.join(args.output_dir, target_file)
            print(f"SEPARATOR_RESULT:{json.dumps({'success': True, 'path': full_path, 'stem': args.stem, 'all_files': output_files})}")
        else:
            print(json.dumps({'success': False, 'error': f"Stem '{args.stem}' not found in output. Produced: {', '.join(output_files)}"}))

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
