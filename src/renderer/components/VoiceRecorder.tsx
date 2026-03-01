import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Circle, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppBridge } from '../src/services/AppBridge';

interface VoiceRecorderProps {
    onRecordingComplete: (filePath: string, startTime: number) => void;
    currentTime: number;
    isPlaying: boolean;
    onStartRecording?: () => void;
    onStopRecording?: () => void;
}

const VoiceRecorder = ({ onRecordingComplete, currentTime, isPlaying, onStartRecording, onStopRecording }: VoiceRecorderProps) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [audioLevel, setAudioLevel] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>(localStorage.getItem('vocap_selected_mic') || '');
    const [showSettings, setShowSettings] = useState(false);
    const [isRawMode, setIsRawMode] = useState(localStorage.getItem('vocap_audio_raw') !== 'false');

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const startTimeRef = useRef<number>(0);

    // Fetch and list audio devices
    useEffect(() => {
        const updateDevices = async () => {
            try {
                // Request temporary access to get device labels
                await navigator.mediaDevices.getUserMedia({ audio: true });
                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = allDevices.filter(device => device.kind === 'audioinput');
                setDevices(audioInputs);
                if (audioInputs.length > 0 && !selectedDeviceId) {
                    setSelectedDeviceId(audioInputs[0].deviceId);
                }
            } catch (err) {
                console.error("Error listing devices:", err);
            }
        };
        updateDevices();
        navigator.mediaDevices.addEventListener('devicechange', updateDevices);
        return () => navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
    }, []);

    // Persist settings
    useEffect(() => {
        localStorage.setItem('vocap_selected_mic', selectedDeviceId);
    }, [selectedDeviceId]);

    useEffect(() => {
        localStorage.setItem('vocap_audio_raw', String(isRawMode));
    }, [isRawMode]);

    // Auto-stop recording if video pauses
    useEffect(() => {
        if (isRecording && !isPlaying) {
            stopRecording();
        }
    }, [isPlaying, isRecording]);

    const startRecording = async () => {
        try {
            startTimeRef.current = currentTime;

            // Clean up previous context if any
            if (audioContextRef.current) {
                await audioContextRef.current.close();
            }

            const constraints = {
                audio: {
                    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                    echoCancellation: !isRawMode,
                    noiseSuppression: !isRawMode,
                    autoGainControl: !isRawMode,
                    channelCount: 1,
                    sampleRate: 48000
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            // Local chunks storage to avoid merging sessions
            const audioChunks: Blob[] = [];

            // Audio setup for VU meter
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            const updateLevel = () => {
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
                setAudioLevel(average / 128);
                animationFrameRef.current = requestAnimationFrame(updateLevel);
            };
            updateLevel();

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                const arrayBuffer = await audioBlob.arrayBuffer();

                // Save via IPC
                const filePath = await AppBridge.saveRecording(arrayBuffer, 'webm');
                onRecordingComplete(filePath, startTimeRef.current);

                // Cleanup
                cleanup();
            };

            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

            if (onStartRecording) onStartRecording();
            setError(null);
        } catch (err) {
            console.error("Microphone access failed:", err);
            setError("Impossible d'accéder au microphone choisi.");
        }
    };

    const cleanup = async () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
            await audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setAudioLevel(0);
    };

    const stopRecording = async () => {
        if (mediaRecorderRef.current && isRecording) {
            // Stop UI and timer immediately
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);

            // Stop analysis first to avoid noise leakage into the end of the file
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current) {
                await audioContextRef.current.suspend();
            }

            mediaRecorderRef.current.stop();
            if (onStopRecording) onStopRecording();
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            cleanup();
        };
    }, []);

    return (
        <div className="flex flex-col gap-4 p-4 bg-zinc-950/50 border border-white/5 rounded-2xl">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="relative size-10 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center">
                        <Mic size={18} className={isRecording ? "text-red-500 animate-pulse" : "text-zinc-500"} />
                        {isRecording && (
                            <motion.div
                                className="absolute inset-0 rounded-full border-2 border-red-500/50"
                                animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                            />
                        )}
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                            Enregistreur Témoin
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className={`p-1 rounded hover:bg-white/5 transition-colors ${showSettings ? 'text-blue-500' : 'text-zinc-600'}`}
                            >
                                <Settings2 size={12} />
                            </button>
                        </h4>
                        <p className="text-[9px] text-zinc-500 font-bold font-mono">
                            {isRecording ? <span className="text-red-500">ENREGISTREMENT EN COURS</span> : "PRÊT À ENREGISTRER"}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <span className="text-xl font-mono font-black text-white tracking-tighter">
                            {formatTime(recordingTime)}
                        </span>
                    </div>

                    {!isRecording ? (
                        <button
                            onClick={startRecording}
                            className="size-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-[0_0_20px_rgba(220,38,38,0.4)] active:scale-90"
                            title="Lancer l'enregistrement"
                        >
                            <Circle size={20} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            onClick={stopRecording}
                            className="size-12 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-all group active:scale-90 border border-white/5"
                            title="Arrêter l'enregistrement"
                        >
                            <Square size={16} fill="white" className="group-hover:scale-110 transition-transform" />
                        </button>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="pb-2">
                            <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1 block">MICROPHONE</label>
                            <select
                                value={selectedDeviceId}
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2 text-[10px] font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all custom-scrollbar"
                            >
                                {devices.map(device => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center justify-between py-2 border-t border-white/5 mt-1">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-white uppercase tracking-wider">Audio Brut (Raw)</span>
                                <span className="text-[7px] text-zinc-500 uppercase font-bold">Désactive écho / réduction bruit</span>
                            </div>
                            <button
                                onClick={() => setIsRawMode(!isRawMode)}
                                className={`w-8 h-4 rounded-full transition-all relative ${isRawMode ? 'bg-blue-600' : 'bg-zinc-800'}`}
                            >
                                <div className={`absolute top-0.5 left-0.5 size-3 bg-white rounded-full transition-all ${isRawMode ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* VU Meter Bars */}
            <div className="flex items-center gap-1 h-3 px-1 bg-black/40 rounded-full overflow-hidden">
                {[...Array(40)].map((_, i) => (
                    <div
                        key={i}
                        className="flex-1 rounded-full transition-all duration-75"
                        style={{
                            height: i < 30 ? '60%' : '100%',
                            backgroundColor: (i / 40) < audioLevel
                                ? (i > 30 ? '#ef4444' : (i > 20 ? '#fbbf24' : '#10b981'))
                                : '#18181b',
                            opacity: (i / 40) < audioLevel ? 1 : 0.3
                        }}
                    />
                ))}
            </div>

            {error && (
                <div className="text-[9px] text-red-500 font-bold uppercase tracking-widest bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                    {error}
                </div>
            )}
        </div>
    );
};

export default VoiceRecorder;
