import React, { useRef } from 'react';
import type { Phrase } from './RhythmicBand';

interface MiniMapProps {
    phrases: Phrase[];
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    className?: string;
}

const MiniMap: React.FC<MiniMapProps> = ({ phrases, duration, currentTime, onSeek, className }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current || duration <= 0) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const seekTime = (x / rect.width) * duration;
        onSeek(Math.max(0, Math.min(duration, seekTime)));
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.buttons !== 1) return; // Only seek if mouse is held down
        handleClick(e);
    };

    return (
        <div
            ref={containerRef}
            className={`relative h-6 bg-slate-900/50 rounded-md overflow-hidden cursor-pointer border border-white/5 group ${className}`}
            onMouseDown={handleClick}
            onMouseMove={handleMouseMove}
        >
            {/* Phrase indicators */}
            <div className="absolute inset-0 pointer-events-none">
                {phrases.map((phrase) => {
                    const startPct = (phrase.startTime / duration) * 100;
                    const widthPct = ((phrase.endTime - phrase.startTime) / duration) * 100;
                    return (
                        <div
                            key={phrase.id}
                            className="absolute h-full opacity-40"
                            style={{
                                left: `${startPct}%`,
                                width: `${Math.max(0.2, widthPct)}%`,
                                backgroundColor: phrase.color || '#e11d48'
                            }}
                        />
                    );
                })}
            </div>

            {/* Progress handle */}
            <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] z-10 transition-all"
                style={{ left: `${(currentTime / duration) * 100}%` }}
            />

            {/* Current Time Indicator Overlay on Hover */}
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
    );
};

export default MiniMap;
