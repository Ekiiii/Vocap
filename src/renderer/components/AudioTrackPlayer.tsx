import { useEffect, useRef } from 'react';

interface AudioTrackPlayerProps {
    path: string;
    isPlaying: boolean;
    currentTime: number;
    volume: number;
    isMuted: boolean;
    startTime?: number;
}

const AudioTrackPlayer = ({ path, isPlaying, currentTime, volume, isMuted, startTime = 0 }: AudioTrackPlayerProps) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const isPlayingRef = useRef(isPlaying);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // Global High-Precision Sync via Custom Event
    useEffect(() => {
        const handleGlobalTimeUpdate = (e: any) => {
            if (!audioRef.current || !isPlayingRef.current) return;

            const targetTime = e.detail.time - startTime;

            // Critical guard: if we are before the start of this track, stay silent and pause
            if (targetTime < 0) {
                if (!audioRef.current.paused) audioRef.current.pause();
                audioRef.current.currentTime = 0;
                return;
            }

            const currentAudioTime = audioRef.current.currentTime;
            const diff = Math.abs(currentAudioTime - targetTime);

            // Drift correction (150ms threshold)
            if (diff > 0.15) {
                audioRef.current.currentTime = targetTime;
            }

            // Ensure playing if it should be
            if (isPlayingRef.current && audioRef.current.paused) {
                audioRef.current.play().catch(() => { });
            }
        };

        window.addEventListener('time-update' as any, handleGlobalTimeUpdate);
        return () => window.removeEventListener('time-update' as any, handleGlobalTimeUpdate);
    }, [startTime]);

    // Initial Sync and Play/Pause state changes
    useEffect(() => {
        if (!audioRef.current) return;

        const targetTime = currentTime - startTime;

        if (isPlaying) {
            if (targetTime >= 0) {
                audioRef.current.currentTime = targetTime;
                audioRef.current.play().catch(e => console.error("Audio play failed:", e));
            } else {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
        } else {
            audioRef.current.pause();
            if (targetTime >= 0) {
                audioRef.current.currentTime = targetTime;
            } else {
                audioRef.current.currentTime = 0;
            }
        }
    }, [isPlaying, startTime]); // We mostly trust the global event for continuous updates during play

    // Manual Seek while paused
    useEffect(() => {
        if (!audioRef.current || isPlaying) return;

        const targetTime = currentTime - startTime;
        if (targetTime >= 0) {
            audioRef.current.currentTime = targetTime;
        } else {
            audioRef.current.currentTime = 0;
        }
    }, [currentTime, isPlaying, startTime]);

    // Sync Volume/Mute
    useEffect(() => {
        if (!audioRef.current) return;
        audioRef.current.volume = volume;
        audioRef.current.muted = isMuted;
    }, [volume, isMuted]);

    // Ensure file:// protocol for local paths
    const audioSrc = path.startsWith('file://') || path.startsWith('http') ? path : `file:///${path.replace(/\\/g, '/')}`;

    return (
        <audio
            ref={audioRef}
            src={audioSrc}
            preload="auto"
            style={{ display: 'none' }}
        />
    );
};

export default AudioTrackPlayer;
