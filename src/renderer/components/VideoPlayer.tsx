import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, ChevronsLeft, ChevronsRight, FileVideo } from 'lucide-react';

interface VideoPlayerProps {
    src: string | null;
    onTimeUpdate: (time: number) => void;
    onFrameUpdate?: (time: number, performanceTime: number) => void;
    onDurationChange: (duration: number) => void;
    onPlayChange?: (isPlaying: boolean) => void;
    onSeeked?: () => void;
    onSelect?: () => void;
    fps?: number;
    isExporting?: boolean;
}

const VideoPlayer = forwardRef(({ src, onTimeUpdate, onFrameUpdate, onDurationChange, onPlayChange, onSeeked, onSelect, fps = 25, isExporting = false }: VideoPlayerProps, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(1);
    const [totalDuration, setTotalDuration] = useState(0);
    const [displayTime, setDisplayTime] = useState(0);
    const rvfcIdRef = useRef<number | null>(null);
    const isSeekingRef = useRef(false);
    const pendingSeekTimeRef = useRef<number | null>(null);

    // Function to seek to specific time
    const seekTo = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.min(Math.max(0, time), totalDuration);
        }
    };

    // Frame-perfect synchronization via requestVideoFrameCallback (RVFC)
    const onVideoFrame = useCallback((_now: number, metadata: any) => {
        if (isExporting) return;
        if (onFrameUpdate) {
            onFrameUpdate(metadata.mediaTime, performance.now());
        }
        if (videoRef.current) {
            rvfcIdRef.current = (videoRef.current as any).requestVideoFrameCallback(onVideoFrame);
        }
    }, [onFrameUpdate, isExporting]);

    useEffect(() => {
        const video = videoRef.current;
        if (video && 'requestVideoFrameCallback' in video) {
            rvfcIdRef.current = (video as any).requestVideoFrameCallback(onVideoFrame);
        }
        return () => {
            if (video && rvfcIdRef.current !== null) {
                (video as any).cancelVideoFrameCallback(rvfcIdRef.current);
            }
        };
    }, [onVideoFrame, src]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
        }
    };

    const handleFrameStep = (frames: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += frames * (1 / fps);
        }
    };

    useImperativeHandle(ref, () => ({
        seek: (time: number) => {
            const video = videoRef.current as any;
            if (video) {
                if (isSeekingRef.current) {
                    pendingSeekTimeRef.current = time;
                    return;
                }

                isSeekingRef.current = true;
                if ('fastSeek' in video) {
                    (video as any).fastSeek(time);
                } else {
                    video.currentTime = time;
                }
            }
        },
        getDimensions: () => {
            if (videoRef.current) {
                return {
                    width: videoRef.current.videoWidth,
                    height: videoRef.current.videoHeight
                };
            }
            return null;
        },
        togglePlay: () => {
            togglePlay();
        },
        stepFrame: (frames: number) => {
            handleFrameStep(frames);
        },
        seekRelative: (seconds: number) => {
            if (videoRef.current) {
                videoRef.current.currentTime += seconds;
            }
        },
        getCurrentTime: () => (videoRef.current as HTMLVideoElement)?.currentTime || 0,
        setVolume: (v: number) => {
            const newVol = Math.max(0, Math.min(1, v));
            setVolume(newVol);
            if (videoRef.current) videoRef.current.volume = newVol;
        },
        getVolume: () => volume,
        toggleMute: () => {
            const newVol = volume > 0 ? 0 : 1;
            setVolume(newVol);
            if (videoRef.current) videoRef.current.volume = newVol;
        },
        getVideoElement: () => videoRef.current
    }));

    const updatePlayState = (playing: boolean) => {
        setIsPlaying(playing);
        if (onPlayChange) onPlayChange(playing);
    };


    const handleTimeUpdate = () => {
        if (isSeekingRef.current) return;
        if (videoRef.current) {
            const time = videoRef.current.currentTime;
            setDisplayTime(time);
            onTimeUpdate(time);
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const d = videoRef.current.duration;
            setTotalDuration(d);
            onDurationChange(d);
        }
    };

    return (
        <div className={`relative flex-1 flex flex-col min-h-0 bg-black group select-none overflow-hidden transition-all duration-500`}>
            {/* Video Container */}
            <div
                className="relative flex-1 min-h-0 flex items-center justify-center bg-[#05070a]"
                onClick={() => !src && onSelect?.()}
            >
                {src ? (
                    <video
                        ref={videoRef}
                        src={src}
                        className="w-full h-full object-contain"
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onPlay={() => updatePlayState(true)}
                        onPause={() => updatePlayState(false)}
                        onSeeked={() => {
                            isSeekingRef.current = false;
                            if (pendingSeekTimeRef.current !== null) {
                                const nextTime = pendingSeekTimeRef.current;
                                pendingSeekTimeRef.current = null;
                                isSeekingRef.current = true; // Set it back to true for the next seek
                                seekTo(nextTime);
                            }
                            onSeeked?.();
                        }}
                        onClick={togglePlay}
                        crossOrigin="anonymous"
                    />
                ) : (
                    <div
                        className="w-full h-full flex flex-col items-center justify-center bg-[#0a0a0c] cursor-pointer hover:bg-zinc-900 transition-all group/import relative overflow-hidden pb-24"
                    >
                        {/* Decorative background element */}
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(225,29,72,0.05)_0%,_transparent_70%)]"></div>

                        <div className="relative flex flex-col items-center gap-8">
                            <div className="w-24 h-24 rounded-[32px] bg-zinc-900 border border-white/5 flex items-center justify-center group-hover/import:scale-105 group-hover/import:border-red-500/30 transition-all duration-500 shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
                                <FileVideo size={32} className="text-red-600 group-hover/import:text-red-500 transition-colors" />
                            </div>
                            <div className="flex flex-col items-center gap-3">
                                <p className="text-white font-black uppercase tracking-[0.4em] text-xs">Ouvrir une Vidéo</p>
                                <div className="h-0.5 w-8 bg-red-600/30 rounded-full group-hover/import:w-16 group-hover/import:bg-red-600 transition-all duration-500"></div>
                                <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mt-2 px-6 py-2 rounded-full border border-white/5 bg-white/[0.02]">MP4, MKV, MOV</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Change Video Icon (Top Right) */}
            {src && (
                <button
                    onClick={onSelect}
                    className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-zinc-900 border border-zinc-700/50 text-zinc-400 hover:text-white rounded-lg transition-all opacity-0 group-hover:opacity-100 backdrop-blur-sm"
                    title="Changer de vidéo (Source)"
                >
                    <FileVideo size={18} />
                </button>
            )}

            {/* Controls Bar - Pure Black Background */}
            <div className={`absolute bottom-0 inset-x-0 h-14 bg-black flex items-center px-4 gap-4 shrink-0 border-t border-white/10 z-30 transition-all duration-300 ${!src ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

                {/* Play/Pause */}
                <button
                    onClick={togglePlay}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-black hover:scale-110 active:scale-95 transition-all shadow-lg shadow-white/10"
                >
                    {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
                </button>

                {/* Seek Bar */}
                <div className="flex-1 flex items-center gap-3 group/seek">
                    <span className="text-[10px] font-mono text-zinc-400 min-w-[45px] text-right">{formatTimecode(displayTime, fps)}</span>
                    <div className="relative flex-1 h-8 flex items-center cursor-pointer">
                        <input
                            type="range"
                            min={0}
                            max={totalDuration || 100}
                            step={0.01}
                            value={displayTime}
                            onChange={(e) => {
                                const time = parseFloat(e.target.value);
                                seekTo(time);
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                        />
                        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden relative">
                            <div
                                className="h-full bg-[#e11d48] relative"
                                style={{ width: `${(displayTime / (totalDuration || 1)) * 100}%` }}
                            >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/seek:opacity-100 transition-opacity"></div>
                            </div>
                        </div>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-600 min-w-[45px]">{formatTimecode(totalDuration, fps)}</span>
                </div>

                {/* Volume & Frame Step */}
                <div className="flex items-center gap-2 border-l border-white/10 pl-4">
                    <div className="flex items-center gap-1 mr-2 group/vol relative">
                        <button
                            onClick={() => setVolume(volume === 0 ? 1 : 0)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                        <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-300">
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={volume}
                                onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setVolume(v);
                                    if (videoRef.current) videoRef.current.volume = v;
                                }}
                                className="w-20 h-1 bg-zinc-800 appearance-none rounded-full accent-[#e11d48] cursor-pointer"
                            />
                        </div>
                    </div>

                    <button
                        onClick={() => handleFrameStep(-1)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Image précédente"
                    >
                        <ChevronsLeft size={18} />
                    </button>
                    <button
                        onClick={() => handleFrameStep(1)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Image suivante"
                    >
                        <ChevronsRight size={18} />
                    </button>
                    <button
                        onClick={() => videoRef.current?.requestFullscreen()}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Plein écran"
                    >
                        <Maximize size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
});

function formatTimecode(seconds: number, fps: number = 25): string {
    if (isNaN(seconds) || seconds === Infinity) return '00:00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * fps);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

VideoPlayer.displayName = 'VideoPlayer';
export default VideoPlayer;
