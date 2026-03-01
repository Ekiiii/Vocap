import React, { useEffect, useState, useRef } from 'react';
import { AppBridge } from '../src/services/AppBridge';
import TitleBar from './TitleBar';

const SecondaryVideo: React.FC = () => {
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const currentTimeRef = useRef(currentTime);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

    // Sync Play/Pause state
    useEffect(() => {
        if (!videoRef.current) return;
        if (isPlaying && videoRef.current.paused) {
            videoRef.current.play().catch(() => { });
        } else if (!isPlaying && !videoRef.current.paused) {
            videoRef.current.pause();
        }
    }, [isPlaying]);

    useEffect(() => {
        const sub = window.electron.ipcRenderer.on('video-state-update', (state: any) => {
            if (state.src && state.src !== videoSrc) {
                setVideoSrc(state.src);
            }

            if (state.isPlaying !== undefined && state.isPlaying !== isPlaying) {
                setIsPlaying(state.isPlaying);
            }

            if (state.currentTime !== undefined) {
                const diff = Math.abs(state.currentTime - (videoRef.current?.currentTime || 0));

                // Mirror logic: 
                // 1. If paused (user scrubbing), sync immediately
                // 2. If playing, only sync if drift is large (> 1.0s) to avoid loops/stutters
                if (!state.isPlaying || diff > 1.0) {
                    if (videoRef.current) {
                        videoRef.current.currentTime = state.currentTime;
                    }
                    setCurrentTime(state.currentTime);
                }
            }
        });

        return () => {
            window.electron.ipcRenderer.off('video-state-update', sub);
        };
    }, [videoSrc, isPlaying]);

    const handleTogglePlay = () => {
        AppBridge.sendVideoCommand({ type: 'toggle-play' });
    };

    if (!videoSrc) {
        return (
            <div className="h-screen w-full flex flex-col bg-black">
                <TitleBar />
                <div className="flex-1 flex items-center justify-center text-zinc-700 uppercase font-black tracking-[0.3em] text-[10px]">
                    En attente du flux vidéo...
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-full flex flex-col bg-black overflow-hidden relative group">
            <TitleBar />
            <div className="flex-1 relative" onClick={handleTogglePlay}>
                <video
                    ref={videoRef}
                    src={videoSrc || ''}
                    muted
                    className="w-full h-full object-contain"
                    onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                />
            </div>

            {/* Overlay info */}
            <div className="absolute bottom-4 right-4 bg-black/60 px-3 py-1 rounded-full border border-white/10 text-[10px] font-mono text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
                {Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(2).padStart(5, '0')}
            </div>
        </div>
    );
};

export default SecondaryVideo;
