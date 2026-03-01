import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';

export interface Phrase {
    id: string;
    startTime: number;
    endTime: number;
    text: string;
    characterId: string;
    character?: string;
    color: string;
    calligraphy?: number;
    isOffScreen?: boolean;
    line?: number;
    offsets?: number[];
    intent?: string;
    words?: { word: string; start: number; end: number }[];
}

interface Marker {
    id: string;
    time: number;
    type?: 'scene' | 'loop';
}

interface RhythmicBandProps {
    currentTime: number;
    isPlaying: boolean;
    markers?: Marker[];
    phrases: Phrase[];
    pixelsPerSecond?: number;
    onPhraseUpdate?: (phrase: Phrase) => void;
    onDeletePhrase?: (id: string) => void;
    onSeek?: (time: number) => void;
    onDeleteMarker?: (id: string) => void;
    onMarkerUpdate?: (marker: Marker) => void;
    onSplitPhrase?: (id: string, splitIndex: number) => void;
    isExporting?: boolean;
    duration: number;
    theme?: 'dark' | 'light';
    fontSize?: number;
    fontFamily?: string;
    shortcuts?: Record<string, string>;
    onInteractionEnd?: () => void;
    onInteractionStart?: () => void;
    isTransparent?: boolean;
    backgroundColor?: string;
    fps?: number;
}

const RhythmicBand = forwardRef<any, RhythmicBandProps>(({
    currentTime,
    duration,
    isPlaying,
    markers = [],
    phrases,
    pixelsPerSecond = 400,
    onPhraseUpdate,
    onDeletePhrase,
    onSeek,
    onDeleteMarker,
    onMarkerUpdate,
    onSplitPhrase,
    isExporting = false,
    theme = 'dark',
    fontSize = 32,
    fontFamily = 'Outfit',
    shortcuts,
    onInteractionEnd,
    onInteractionStart,
    isTransparent = false,
    backgroundColor = '#050505',
    fps = 25
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragMode, setDragMode] = useState<'move' | 'stretch-start' | 'stretch-end' | 'segment-edge' | 'marker-move' | null>(null);
    const [activePhraseId, setActivePhraseId] = useState<string | null>(null);
    const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
    const [draggingSegmentIdx, setDraggingSegmentIdx] = useState<number | null>(null);
    const [draggingEdgeIdx, setDraggingEdgeIdx] = useState<number | null>(null); // 0 for start, 1 for end
    const [isDraggingScrollbar, setIsDraggingScrollbar] = useState(false);
    const [isDraggingMiddle, setIsDraggingMiddle] = useState(false);
    const [middleDragStartX, setMiddleDragStartX] = useState(0);
    const [middleDragStartTime, setMiddleDragStartTime] = useState(0);

    const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState("");

    const [dragOffset, setDragOffset] = useState(0);
    const isDark = theme === 'dark';

    // High-resolution display time driven by parent state or forced render
    const displayTimeRef = useRef(currentTime);
    const phrasesRef = useRef(phrases);
    const markersRef = useRef(markers);
    const lastSeekTimeRef = useRef(0);
    const exportTilesRef = useRef<HTMLCanvasElement[]>([]);
    const TILE_DURATION = 10; // seconds

    useEffect(() => {
        phrasesRef.current = phrases;
    }, [phrases]);

    useEffect(() => {
        markersRef.current = markers;
    }, [markers]);

    // OPTIMIZATION: Binary Search to find visible phrase range
    const getVisiblePhraseRange = (allPhrases: Phrase[], currentTime: number, width: number, pixelsPerSecond: number) => {
        if (allPhrases.length === 0) return { start: 0, end: 0 };

        // Visible start time (buffer of 2s left)
        const visibleStart = currentTime - (width / 4 / pixelsPerSecond) - 2;
        const visibleEnd = currentTime + (width * 0.75 / pixelsPerSecond) + 2;

        // Search slightly earlier to account for long phrases starting before the window
        const searchStart = visibleStart - 60;

        // Binary search for start index based on startTime
        let low = 0, high = allPhrases.length - 1, startIdx = 0;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (allPhrases[mid].startTime < searchStart) {
                low = mid + 1;
            } else {
                startIdx = mid;
                high = mid - 1;
            }
        }

        // Linear scan for end index (since phrases can overlap, but usually sorted by starTime)
        // We just need to go until phrase.startTime > visibleEnd
        let endIdx = startIdx;
        while (endIdx < allPhrases.length && allPhrases[endIdx].startTime < visibleEnd) {
            endIdx++;
        }

        return { start: startIdx, end: endIdx };
    };

    // OPTIMIZATION: Text Measurement Cache
    const textWidthCache = useRef<Record<string, number>>({});
    const lastFontRef = useRef<string>('');

    const getXFromTime = React.useCallback((time: number, width: number, displayTime: number, ppsOverride?: number, uiWidthOverride?: number) => {
        // V20: Use absolute UI width to calculate redBarX if provided.
        // This prevents the line from moving further right on a wider 1920px export,
        // which would cause the text to hit the line too late compared to the UI.
        const baseWidth = uiWidthOverride || width;
        const redBarX = baseWidth / 4;
        const pps = ppsOverride || pixelsPerSecond;
        return redBarX + (time - displayTime) * pps;
    }, [pixelsPerSecond]);

    const getTimeFromX = React.useCallback((x: number, width: number, displayTime: number, ppsOverride?: number, uiWidthOverride?: number) => {
        const baseWidth = uiWidthOverride || width;
        const redBarX = baseWidth / 4;
        const pps = ppsOverride || pixelsPerSecond;
        return (x - redBarX) / pps + displayTime;
    }, [pixelsPerSecond]);

    const lastVideoTimeRef = useRef<number>(currentTime);
    const lastVideoPerfRef = useRef<number>(performance.now());
    const exportUiWidthRef = useRef<number | undefined>(undefined); // V20
    const logicalExportWidthRef = useRef<number | undefined>(undefined); // V22: Sharpness logic width
    const logicalExportHeightRef = useRef<number | undefined>(undefined); // V22: Sharpness logic height
    const isWheelingRef = useRef(false); // V46: Wheel stabilization
    const isDraggingRef = useRef(false); // New: Track drag for sync blocking
    const lastUserSeekTimeRef = useRef<number>(0); // New: Grace period to avoid snap-back
    const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // V76: If not playing, or for jumps > 0.1s, we snap instantly
        // This ensures the band is always exactly where the user seeks.
        const delta = Math.abs(displayTimeRef.current - currentTime);
        const now = performance.now();
        const isInGracePeriod = now - lastUserSeekTimeRef.current < 400; // 400ms grace

        // Important: Don't sync if we are dragging, wheeling, or in post-seek grace period
        if ((!isPlaying || delta > 0.1) && !isWheelingRef.current && !isDraggingRef.current && !isInGracePeriod) {
            displayTimeRef.current = currentTime;
            lastVideoTimeRef.current = currentTime;
            lastVideoPerfRef.current = performance.now();
        }
    }, [currentTime, isPlaying]);

    // High-precision time sync via window events (V74)
    useEffect(() => {
        const handleHighResSync = (e: any) => {
            if (!isPlaying) return;
            const { time, perf } = e.detail;
            lastVideoTimeRef.current = time;
            lastVideoPerfRef.current = perf;
        };

        window.addEventListener('time-update', handleHighResSync);
        return () => window.removeEventListener('time-update', handleHighResSync);
    }, [isPlaying]);

    const measureTextCached = (ctx: CanvasRenderingContext2D, text: string, font: string) => {
        const key = `${text}-${font}`;
        if (textWidthCache.current[key]) return textWidthCache.current[key];
        ctx.font = font;
        const w = ctx.measureText(text).width;
        textWidthCache.current[key] = w;
        return w;
    };

    const draw = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, ppsOverride?: number) => {
        const baseline = height * 0.58;
        const effectivePPS = ppsOverride || pixelsPerSecond;

        const isBgLight = backgroundColor.startsWith('#') ? (
            ((parseInt(backgroundColor.slice(1, 3), 16) * 0.299 +
                parseInt(backgroundColor.slice(3, 5), 16) * 0.587 +
                parseInt(backgroundColor.slice(5, 7), 16) * 0.114) / 255 > 0.6)
        ) : false;

        const gridColor = isBgLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.04)';
        const timeMarkerColor = isBgLight ? '#475569' : '#52525b';
        const edgeColor = backgroundColor;

        if (!isTransparent) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);
        } else {
            ctx.clearRect(0, 0, width, height);
        }

        const currentFont = `bold ${fontSize + 20}px "${fontFamily}", sans-serif`;
        if (lastFontRef.current !== currentFont) {
            textWidthCache.current = {};
            lastFontRef.current = currentFont;
        }

        // Grid
        ctx.lineWidth = 1;
        ctx.font = 'bold 9px monospace';
        const lineSpacing = 60;
        for (let i = 0; i < 4; i++) {
            const lineY = baseline + (i - 1.5) * lineSpacing;
            ctx.strokeStyle = gridColor;
            ctx.beginPath();
            ctx.moveTo(0, lineY); ctx.lineTo(width, lineY);
            ctx.stroke();
            ctx.fillStyle = timeMarkerColor;
            ctx.fillText(`L${i + 1}`, 8, lineY - 5);
        }

        // Ruler
        // Ruler
        // V20: Use the exact absolute ui physical width if we're rendering for export, guaranteeing 
        // the red line is always at the exact same physical distance from the left edge.
        const logicalWidth = exportUiWidthRef.current || width;

        const visibleSecsLeft = (logicalWidth / 4) / effectivePPS;
        const visibleSecsRight = (logicalWidth * 0.75) / effectivePPS;
        // The export width might be physically wider than logicWidth, leading to blank sides 
        // if we don't render enough seconds to fill the entire physical width.
        const physicalVisibleSecsRight = (width * 0.75) / effectivePPS;
        const startSec = Math.floor(time - visibleSecsLeft - 1);
        const endSec = Math.ceil(time + Math.max(visibleSecsRight, physicalVisibleSecsRight) + 1);

        for (let s = startSec; s <= endSec; s++) {
            const x = getXFromTime(s, width, time, effectivePPS, exportUiWidthRef.current);
            if (x > -effectivePPS && x < width + effectivePPS) {
                const isMajor = s % 5 === 0;
                ctx.strokeStyle = isMajor ? (isBgLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.3)') : gridColor;
                ctx.beginPath();
                ctx.moveTo(x, 0); ctx.lineTo(x, height);
                ctx.stroke();
                ctx.fillStyle = timeMarkerColor;
                ctx.font = 'bold 9px monospace';
                ctx.fillText(`${s}s`, x + 4, 12);
            }

            const framesPerSec = fps;
            for (let f = 1; f < framesPerSec; f++) {
                const fx = getXFromTime(s + f / framesPerSec, width, time, effectivePPS, exportUiWidthRef.current);
                if (fx < 0 || fx > width) continue;
                ctx.strokeStyle = isBgLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
                ctx.beginPath();
                ctx.moveTo(fx, 0); ctx.lineTo(fx, 4);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(fx, height - 4); ctx.lineTo(fx, height);
                ctx.stroke();
            }
        }

        // Pass 1: Scene Markers (Plan) - Bottom Layer
        const currentMarkers = markersRef.current;
        for (const m of currentMarkers.filter(xm => xm.type !== 'loop')) {
            const x = getXFromTime(m.time, width, time, effectivePPS, exportUiWidthRef.current);
            if (x < -10 || x > width + 10) continue;
            const isSelected = selectedMarkerId === m.id;
            const markerColor = '#ef4444';

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, height);

            if (isSelected) {
                ctx.shadowBlur = 15; ctx.shadowColor = markerColor;
                ctx.strokeStyle = markerColor; ctx.lineWidth = 4;
            } else {
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
                ctx.lineWidth = 2;
            }
            ctx.stroke();
            ctx.restore();
        }

        // Pass 2: Loop Markers - Top Layer
        for (const m of currentMarkers.filter(xm => xm.type === 'loop')) {
            const x = getXFromTime(m.time, width, time, effectivePPS, exportUiWidthRef.current);
            if (x < -50 || x > width + 50) continue;
            const isSelected = selectedMarkerId === m.id;
            const markerColor = '#3b82f6';

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, height);

            if (isSelected) {
                ctx.shadowBlur = 20; ctx.shadowColor = markerColor;
                ctx.strokeStyle = markerColor; ctx.lineWidth = 4;
            } else {
                ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
                ctx.setLineDash([8, 4]);
                ctx.lineWidth = 2;
            }
            ctx.stroke();

            // Loop Marker Badge
            const badgeSize = 20;
            const badgeY = height - 35;
            ctx.shadowBlur = 0;
            ctx.fillStyle = markerColor;
            ctx.beginPath();
            ctx.roundRect(x - badgeSize / 2, badgeY, badgeSize, badgeSize, 4);
            ctx.fill();

            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const loopIndex = currentMarkers.filter(xm => xm.type === 'loop' && xm.time <= m.time).length;
            ctx.fillText(loopIndex.toString(), x, badgeY + badgeSize / 2);

            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.restore();
        }

        // Phrases
        const allPhrases = phrasesRef.current;
        const { start, end } = getVisiblePhraseRange(allPhrases, time, width, effectivePPS);

        for (let i = start; i < end; i++) {
            const phrase = allPhrases[i];
            const startX = getXFromTime(phrase.startTime, width, time, effectivePPS, exportUiWidthRef.current);
            const endX = getXFromTime(phrase.endTime, width, time, effectivePPS, exportUiWidthRef.current);
            const y = baseline + ((phrase.line ?? 1) - 1.5) * lineSpacing;
            const isHovered = activePhraseId === phrase.id;
            const isInteracting = isDragging && isHovered;

            ctx.save();
            // Badge
            const badgeText = (phrase.character || 'PERSO').toUpperCase() + (phrase.intent ? ` (${phrase.intent.toUpperCase()})` : '');
            ctx.font = `bold 12px "${fontFamily}", sans-serif`;
            const labelW = measureTextCached(ctx, badgeText, ctx.font) + 12;
            ctx.fillStyle = phrase.color;
            ctx.beginPath(); ctx.roundRect(startX - 6, y - 56, labelW, 20, 6); ctx.fill();
            ctx.fillStyle = getContrastColor(phrase.color);
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, startX, y - 46);
            ctx.textBaseline = 'alphabetic';

            // Segments
            ctx.font = `bold ${fontSize + 20}px "${fontFamily}", sans-serif`;
            const segments = phrase.text.split('||');
            let offsets = phrase.offsets || [];
            if (offsets.length !== segments.length * 2) {
                offsets = [];
                for (let j = 0; j < segments.length; j++) {
                    offsets.push(j / segments.length, (j === segments.length - 1) ? 1.0 : (j + 0.9) / segments.length);
                }
            }

            const availX = endX - startX;
            for (let j = 0; j < segments.length; j++) {
                const sX = startX + availX * offsets[j * 2];
                const eX = startX + availX * offsets[j * 2 + 1];
                const sW = eX - sX;
                const tW = measureTextCached(ctx, segments[j], ctx.font);

                // User requested unlimited stretching (V94)
                const clampedScale = (sW / (tW || 1)) * (phrase.calligraphy || 1.0);

                ctx.save();
                ctx.translate(sX, y);
                ctx.scale(clampedScale, 1.0);
                ctx.fillStyle = phrase.color;

                // Selection Glow
                if (isHovered || isInteracting) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = phrase.color;
                }

                ctx.fillText(segments[j].trim(), 0, 0);
                if (phrase.isOffScreen) {
                    ctx.strokeStyle = phrase.color; ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(tW, 8); ctx.stroke();
                }
                ctx.restore();

                // Internal Handles (Segment Boundaries)
                if ((isHovered || isInteracting) && !isExporting) {
                    const drawHandle = (hx: number, hy: number, isRight: boolean) => {
                        const offset = isRight ? -10 : 10; // Offset inwards
                        ctx.save();

                        // Enhanced Shadow for contrast on all backgrounds
                        ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(0,0,0,0.8)';
                        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;

                        // Glassy bar with stroke
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; // Subtle dark stroke for white handles
                        ctx.lineWidth = 0.5;

                        ctx.beginPath(); ctx.roundRect(hx + offset - 1, hy - 12, 2, 24, 1);
                        ctx.fill();
                        ctx.stroke(); // Apply stroke

                        // Little dot indicator
                        ctx.fillStyle = 'white';
                        ctx.beginPath(); ctx.arc(hx + offset, hy, 2, 0, Math.PI * 2); ctx.fill();
                        ctx.restore();
                    };
                    if (j > 0) drawHandle(sX, y - 10, false);
                    if (j < segments.length - 1) drawHandle(eX, y - 10, true);
                }
            }
            ctx.restore();

            // Main Handles (Neon - Phrase Boundaries)
            if ((isHovered || isInteracting) && !isExporting) {
                const isDragStart = isInteracting && dragMode === 'stretch-start';
                const isDragEnd = isInteracting && dragMode === 'stretch-end';
                const drawNeon = (hx: number, hy: number, isDragging: boolean, isRight: boolean) => {
                    const offset = isRight ? 8 : -8; // Offset outwards
                    ctx.save();

                    // Strong Shadow for maximum visibility
                    ctx.shadowBlur = 15; ctx.shadowColor = '#e11d48';

                    ctx.fillStyle = isDragging ? '#fb7185' : '#e11d48';
                    // Add white stroke to neon handles for contrast against dark/red backgrounds
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 1.5;

                    // The "hook" shape for phrase boundaries
                    ctx.beginPath();
                    if (isRight) {
                        ctx.roundRect(hx + offset - 2, hy - 20, 6, 40, 3);
                    } else {
                        ctx.roundRect(hx + offset - 4, hy - 20, 6, 40, 3);
                    }
                    ctx.fill();
                    ctx.stroke(); // Apply stroke

                    // Center accent
                    ctx.shadowBlur = 0; ctx.fillStyle = 'white';
                    ctx.beginPath(); ctx.arc(hx + offset + (isRight ? 1 : -1), hy, 2, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                };
                drawNeon(startX, y - 12, isDragStart, false);
                drawNeon(endX, y - 12, isDragEnd, true);
            }
        }

        // Red Bar
        const logicalWidthForBar = exportUiWidthRef.current || width;
        const rbX = logicalWidthForBar / 4;
        ctx.save();
        ctx.shadowBlur = 15; ctx.shadowColor = 'rgba(225, 29, 72, 0.6)';
        ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rbX, 0); ctx.lineTo(rbX, height); ctx.stroke();
        ctx.fillStyle = '#e11d48';
        ctx.beginPath(); ctx.arc(rbX, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Edges
        const edgeGrad = ctx.createLinearGradient(0, 0, width, 0);
        edgeGrad.addColorStop(0, edgeColor); edgeGrad.addColorStop(0.05, 'rgba(0,0,0,0)');
        edgeGrad.addColorStop(0.95, 'rgba(0,0,0,0)'); edgeGrad.addColorStop(1, edgeColor);
        ctx.fillStyle = edgeGrad; ctx.fillRect(0, 0, width, height);

        // Scrollbar
        if (duration > 0 && !isExporting) {
            const sbH = 6;
            const sbY = height - sbH - 4;
            ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            ctx.fillRect(4, sbY, width - 8, sbH);
            const vDur = width / effectivePPS;
            const hW = Math.max(15, (vDur / duration) * (width - 8));
            let hX = 4 + ((time - (width / 4) / effectivePPS) / duration) * (width - 8);
            hX = Math.max(4, Math.min(width - 4 - hW, hX));
            ctx.fillStyle = isDraggingScrollbar ? (isDark ? '#52525b' : '#94a3b8') : (isDark ? '#3f3f46' : '#cbd5e1');
            ctx.beginPath(); ctx.roundRect(hX, sbY, hW, sbH, 3); ctx.fill();
        }
    };

    useImperativeHandle(ref, () => ({
        captureFrame: (videoElement?: HTMLVideoElement) => {
            if (canvasRef.current) {
                // If we have a video element, we need a composite canvas
                if (videoElement) {
                    const compositeCanvas = document.createElement('canvas');
                    compositeCanvas.width = canvasRef.current.width;
                    compositeCanvas.height = canvasRef.current.height;
                    const ctx = compositeCanvas.getContext('2d', { alpha: false });
                    if (ctx) {
                        // 1. Draw video background
                        ctx.drawImage(videoElement, 0, 0, compositeCanvas.width, compositeCanvas.height);
                        // 2. Layer rhythm band on top
                        ctx.drawImage(canvasRef.current, 0, 0);
                        return compositeCanvas.toDataURL('image/png');
                    }
                }
                return canvasRef.current.toDataURL('image/png');
            }
            return null;
        },
        setExportResolution: (width: number, height: number, logicalUiWidth?: number) => {
            if (canvasRef.current) {
                if (logicalUiWidth) {
                    exportUiWidthRef.current = logicalUiWidth;
                }
                // V22: Export Sharpness (2x Supersampling)
                const supersample = 2;
                canvasRef.current.width = width * supersample;
                canvasRef.current.height = height * supersample;

                logicalExportWidthRef.current = width;
                logicalExportHeightRef.current = height;

                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    ctx.resetTransform(); // Reset any previous scale
                    ctx.scale(supersample, supersample);
                }
            }
        },
        forceRender: (time: number, ppsOverride?: number) => {
            displayTimeRef.current = time;
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d', { alpha: isTransparent, desynchronized: true });
                if (ctx) {
                    // V19: Pure Raw Rendering (Removing all multipliers)
                    const effectivePps = ppsOverride || pixelsPerSecond;

                    // V22: Use logical export boundaries if we are exporting, otherwise UI boundaries
                    const renderWidth = isExporting ? (logicalExportWidthRef.current || canvas.width) : canvas.width;
                    const renderHeight = isExporting ? (logicalExportHeightRef.current || canvas.height) : canvas.height;

                    // V13: Bypass tiles for export to ensure frame-accurate precision
                    if (isExporting || exportTilesRef.current.length === 0) {
                        draw(ctx, renderWidth, renderHeight, time, effectivePps);
                    } else {
                        renderFromTiles(ctx, renderWidth, renderHeight, time, effectivePps);
                    }
                }
            }
        },
        prepareExportStrip: async (onProgress?: (pct: number) => void, ppsOverride?: number) => {
            if (!duration) return;
            const numTiles = Math.ceil(duration / TILE_DURATION);
            const tiles: HTMLCanvasElement[] = [];
            const effectivePPS = ppsOverride || pixelsPerSecond;
            const tileWidth = TILE_DURATION * effectivePPS;
            const canvasHeight = canvasRef.current?.height || 300;

            for (let i = 0; i < numTiles; i++) {
                const tCanvas = document.createElement('canvas');
                tCanvas.width = tileWidth;
                tCanvas.height = canvasHeight;
                const tCtx = tCanvas.getContext('2d', { alpha: true });
                if (tCtx) {
                    drawStaticRange(tCtx, tileWidth, canvasHeight, i * TILE_DURATION, (i + 1) * TILE_DURATION, effectivePPS);
                }
                tiles.push(tCanvas);
                if (onProgress) onProgress(Math.floor((i / numTiles) * 100));
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
            }
            if (onProgress) onProgress(100);
            exportTilesRef.current = tiles;
        },
        renderFrame: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, ppsOverride?: number) => {
            // High-fidelity render for export: includes everything (phrases, markers, red bar)
            draw(ctx, width, height, time, ppsOverride);
        },
        getExportTilesAsBlobs: async (): Promise<Blob[]> => {
            const blobs: Blob[] = [];
            for (const canvas of exportTilesRef.current) {
                const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
                if (blob) blobs.push(blob);
            }
            return blobs;
        },
        canvasRef: canvasRef
    }));

    const renderFromTiles = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, pps: number) => {
        if (!isTransparent) {
            const bgColor = backgroundColor || (isDark ? '#18181b' : '#fdfaf0');
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);
        } else {
            ctx.clearRect(0, 0, width, height);
        }

        const pixelsPerSec = pps;

        // Current time window: Start at time
        // Tiles are generated such that T=0 is at X=0.
        // We need to shift everything so that 'time' is at 'width/4'.
        const redBarX = width / 4;
        const tileWidth = TILE_DURATION * pixelsPerSec;
        const numTiles = exportTilesRef.current.length;

        for (let i = 0; i < numTiles; i++) {
            const tileStartTime = i * TILE_DURATION;
            // The tile at tileStartTime should be at targetX relative to the red bar
            const targetX = redBarX + (tileStartTime - time) * pixelsPerSec;

            if (targetX < width && targetX + tileWidth > 0) {
                // V12: Removed Math.round() to enable sub-pixel rendering (smoother movement)
                ctx.drawImage(exportTilesRef.current[i], targetX, 0);
            }
        }

        // Red Bar
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(225, 29, 72, 0.6)';
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(redBarX, 0);
        ctx.lineTo(redBarX, height);
        ctx.stroke();
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.arc(redBarX, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const edgeColor = isTransparent ? 'rgba(0,0,0,0)' : (backgroundColor || (isDark ? '#18181b' : '#fdfaf0'));
        const edgeGrad = ctx.createLinearGradient(0, 0, width, 0);
        edgeGrad.addColorStop(0, edgeColor);
        edgeGrad.addColorStop(0.05, 'rgba(0,0,0,0)');
        edgeGrad.addColorStop(0.95, 'rgba(0,0,0,0)');
        edgeGrad.addColorStop(1, edgeColor);
        ctx.fillStyle = edgeGrad;
        ctx.fillRect(0, 0, width, height);
    };

    const drawStaticRange = (ctx: CanvasRenderingContext2D, width: number, height: number, startTime: number, endTime: number, pps: number = 400) => {
        const baseline = height * 0.58;
        const isDark = theme === 'dark';
        const bgColor = backgroundColor || (isDark ? '#18181b' : '#fdfaf0');
        ctx.textBaseline = 'middle'; // Fix for vertical rendering misalignment in export tiles

        const isBgLight = bgColor.startsWith('#') ? (
            ((parseInt(bgColor.slice(1, 3), 16) * 0.299 +
                parseInt(bgColor.slice(3, 5), 16) * 0.587 +
                parseInt(bgColor.slice(5, 7), 16) * 0.114) / 255 > 0.6)
        ) : false;

        const gridColor = isBgLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';
        const timeMarkerColor = isBgLight ? '#475569' : '#a1a1aa';

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        // Grid Lines
        ctx.lineWidth = 1;
        ctx.font = 'bold 9px monospace';
        const lineSpacing = 60;
        for (let i = 0; i < 4; i++) {
            const y = baseline + (i - 1.5) * lineSpacing;
            ctx.strokeStyle = gridColor;
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Time markers
        // Time markers
        for (let s = Math.floor(startTime); s <= Math.ceil(endTime); s++) {
            const x = (s - startTime) * pps;

            if (x > -pps && x < width + pps) {
                const isMajor = s % 5 === 0;
                ctx.strokeStyle = isMajor ? (isBgLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.3)') : gridColor;
                ctx.beginPath();
                ctx.moveTo(x, 0); ctx.lineTo(x, height);
                ctx.stroke();

                ctx.fillStyle = timeMarkerColor;
                ctx.fillText(`${s}s`, x + 4, 12);
            }

            const framesPerSec = fps;
            for (let f = 1; f < framesPerSec; f++) {
                const fx = x + (f / framesPerSec) * pps;
                if (fx < 0 || fx > width) continue;
                ctx.strokeStyle = isBgLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.moveTo(fx, 0); ctx.lineTo(fx, 6);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(fx, height - 6); ctx.lineTo(fx, height);
                ctx.stroke();
            }
        }

        // Markers
        const curMarkers = markersRef.current;
        for (const m of curMarkers) {
            const x = (m.time - startTime) * pps;
            if (x < -200 || x > width + 200) continue;
            ctx.strokeStyle = m.type === 'loop' ? '#3b82f6' : (isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(24, 24, 27, 0.6)');
            ctx.lineWidth = 2;
            if (m.type === 'loop') ctx.setLineDash([10, 5]);
            else ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        // Phrases
        const allPhrases = phrasesRef.current;
        const currentFont = `bold ${fontSize + 20}px "${fontFamily}", sans-serif`;

        for (const phrase of allPhrases) {
            if (phrase.endTime < startTime || phrase.startTime > endTime) continue;

            const psX = (phrase.startTime - startTime) * pps;
            const peX = (phrase.endTime - startTime) * pps;
            const lineIdx = phrase.line ?? 1;
            const y = baseline + (lineIdx - 1.5) * lineSpacing;

            ctx.save();
            const charName = (phrase.character || 'PERSO').toUpperCase();
            const badgeText = charName + (phrase.intent ? ` (${phrase.intent.toUpperCase()})` : '');

            // Draw Character Badge Capsule (Match Live Fidelity)
            ctx.font = `bold 12px "${fontFamily}", sans-serif`;
            const labelWidth = measureTextCached(ctx, badgeText, ctx.font) + 12;
            ctx.fillStyle = phrase.color;
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(psX - 6, y - 56, labelWidth, 20, 6);
            } else {
                ctx.fillRect(psX - 6, y - 56, labelWidth, 20);
            }
            ctx.fill();

            // Contrast text inside badge
            const getContrastBadgeColor = (hex: string) => {
                if (!hex || !hex.startsWith('#')) return '#ffffff';
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                return luminance > 0.6 ? '#000000' : '#ffffff';
            };
            ctx.fillStyle = getContrastBadgeColor(phrase.color);
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, psX, y - 46);

            ctx.font = currentFont;
            const segments = phrase.text.split('||');
            const numSegs = segments.length;
            let offsets = phrase.offsets || [];
            if (offsets.length !== numSegs * 2) {
                offsets = [];
                for (let i = 0; i < numSegs; i++) {
                    // Tighter packing: reduce the default gap between segments
                    const endPct = (i === numSegs - 1) ? 1.0 : (i + 0.95) / numSegs;
                    offsets.push(i / numSegs, endPct);
                }
            }

            const availableX = peX - psX;
            for (let j = 0; j < segments.length; j++) {
                const segText = segments[j];
                const sPct = offsets[j * 2];
                const ePct = offsets[j * 2 + 1];
                const segStartX = psX + availableX * sPct;
                const segEndX = psX + availableX * ePct;
                const segWidth = segEndX - segStartX;

                ctx.save();
                ctx.font = currentFont;
                const textWidth = measureTextCached(ctx, segText, ctx.font);
                // User requested unlimited stretching (V94)
                const scaleX = (segWidth / (textWidth || 1)) * (phrase.calligraphy || 1.0);
                ctx.translate(segStartX, y);
                ctx.scale(scaleX, 1.0);
                ctx.fillStyle = phrase.color;
                ctx.fillText(segText.trim(), 0, 0);

                if (phrase.isOffScreen) {
                    ctx.strokeStyle = phrase.color; ctx.lineWidth = 2.5; ctx.beginPath();
                    ctx.moveTo(0, 8); ctx.lineTo(textWidth, 8); ctx.stroke();
                }
                ctx.restore();
            }
            ctx.restore();
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: isTransparent, desynchronized: true });
        if (!ctx) return;

        const handleResize = () => {
            if (isExporting) return; // Lock layout during export
            const container = canvas.parentElement;
            if (container && (!canvas.width || !canvas.height || (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight))) {
                canvas.width = container.clientWidth;
                canvas.height = container.clientHeight;
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        // New: Global MouseUp to ensure sync resumes even if released outside
        const handleGlobalMouseUp = () => {
            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                // These states are normally handled by handleMouseUp on the canvas,
                // but we trigger them here just in case.
                setIsDragging(false);
                setIsDraggingMiddle(false);
                setIsDraggingScrollbar(false);
                setDragMode(null);
                if (onInteractionEnd) onInteractionEnd();
            }
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);

        let animationId: number;
        const animate = () => {
            if (isExporting) return; // Completely stop UI loop during export

            const now = performance.now();

            if (isPlaying) {
                // FRAME-LOCKED EXTRAPOLATION:
                // Calculate time since the last captured video frame
                const timeSinceFrame = (now - lastVideoPerfRef.current) / 1000;
                displayTimeRef.current = lastVideoTimeRef.current + timeSinceFrame;
            }

            draw(ctx, canvas.width, canvas.height, displayTimeRef.current);
            animationId = requestAnimationFrame(animate);
        };
        animationId = requestAnimationFrame(animate);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [phrases, pixelsPerSecond, activePhraseId, isPlaying, markers, getXFromTime, isDragging, isExporting, fps, backgroundColor, isTransparent, theme, fontSize, fontFamily]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (onInteractionStart) onInteractionStart();
        isDraggingRef.current = true; // Block sync
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const time = getTimeFromX(x, canvas.width, displayTimeRef.current);

        // Scrollbar Detection
        if (y > canvas.height - 20) {
            setIsDragging(true);
            setIsDraggingScrollbar(true);
            return;
        }

        // Middle Click Navigation (Button 1)
        if (e.button === 1) {
            e.preventDefault();
            setIsDraggingMiddle(true);
            setMiddleDragStartX(x);
            setMiddleDragStartTime(displayTimeRef.current);
            return;
        }

        // Marker Detection
        const hitSize = 10;
        const marker = markers.find(m => Math.abs(getXFromTime(m.time, canvas.width, displayTimeRef.current) - x) < hitSize);
        if (marker) {
            setSelectedMarkerId(marker.id);
            setIsDragging(true);
            setDragMode('marker-move');
            return;
        }
        setSelectedMarkerId(null);

        const baseline = canvas.height * 0.58; // Synced with draw()
        const lineSpacing = 60; // Synced with draw()

        for (const phrase of phrases) {
            const py = baseline + ((phrase.line ?? 1) - 1.5) * lineSpacing;
            const ps = getXFromTime(phrase.startTime, canvas.width, displayTimeRef.current);
            const pe = getXFromTime(phrase.endTime, canvas.width, displayTimeRef.current);

            // Expand vertical hitbox to cover the badge area for selection/interaction
            if (y < py - 60 || y > py + 25) continue;

            // 1. Dissociated Segment Edge Detection (||)
            if (phrase.text.includes('||')) {
                const segments = phrase.text.split('||');
                const numSegs = segments.length;
                let offsets = phrase.offsets || [];
                if (offsets.length !== numSegs * 2) {
                    offsets = [];
                    for (let i = 0; i < numSegs; i++) {
                        const endPct = (i === numSegs - 1) ? 1.0 : (i + 0.9) / numSegs;
                        offsets.push(i / numSegs, endPct);
                    }
                }

                for (let i = 0; i < numSegs; i++) {
                    const sOffset = (offsets[i * 2] === 0) ? 8 : 0;
                    const eOffset = (offsets[i * 2 + 1] === 1.0) ? -8 : 0;

                    const sX = ps + (pe - ps) * offsets[i * 2] + sOffset;
                    const eX = ps + (pe - ps) * offsets[i * 2 + 1] + eOffset;

                    if (Math.abs(x - sX) < 15) {
                        setIsDragging(true); setDragMode('segment-edge'); setActivePhraseId(phrase.id);
                        setDraggingSegmentIdx(i); setDraggingEdgeIdx(0); return;
                    }
                    if (Math.abs(x - eX) < 15) {
                        setIsDragging(true); setDragMode('segment-edge'); setActivePhraseId(phrase.id);
                        setDraggingSegmentIdx(i); setDraggingEdgeIdx(1); return;
                    }
                }
            }

            // 2. Legacy Split Handle Detection (|)
            if (phrase.text.includes('|') && !phrase.text.includes('||') && onSplitPhrase) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = phrase.color;
                    ctx.font = `bold ${fontSize}px "${fontFamily}", sans-serif`;
                    ctx.textBaseline = 'top';
                    const prePipeText = phrase.text.split('|')[0];
                    const prePipeWidth = ctx.measureText(prePipeText).width;
                    const fullWidth = ctx.measureText(phrase.text).width;
                    const available = Math.max(10, pe - ps);
                    const currentScaleX = (available / (fullWidth || 1)) * (phrase.calligraphy || 1.0);
                    const pipeX = ps + (prePipeWidth * currentScaleX) + (ctx.measureText('|').width * currentScaleX / 2);

                    if (Math.abs(x - pipeX) < 15) {
                        onSplitPhrase(phrase.id, 0);
                        return;
                    }
                }
            }

            // 3. Global Phrase Drag/Stretch
            const handleHitSize = 25;
            if (Math.abs(x - ps) < handleHitSize) {
                setIsDragging(true); setDragMode('stretch-start'); setActivePhraseId(phrase.id); return;
            }
            if (Math.abs(x - pe) < handleHitSize) {
                setIsDragging(true); setDragMode('stretch-end'); setActivePhraseId(phrase.id); return;
            }
            if (x > ps && x < pe) {
                setIsDragging(true); setDragMode('move'); setActivePhraseId(phrase.id);
                setDragOffset(phrase.startTime - time); return;
            }
        }
    };

    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const baseline = canvas.height * 0.58;
        const lineSpacing = 60;

        for (const phrase of phrases) {
            const py = baseline + ((phrase.line ?? 1) - 1.5) * lineSpacing;
            const ps = getXFromTime(phrase.startTime, canvas.width, displayTimeRef.current);
            const pe = getXFromTime(phrase.endTime, canvas.width, displayTimeRef.current);

            // Expand hitbox vertically to the top (60px above, 20px below)
            const isHit = y > py - 60 && y < py + 20 && x > ps - 20 && x < pe + 20;

            if (isHit) {
                setEditingPhraseId(phrase.id);
                setEditingValue(phrase.text);
                window.dispatchEvent(new CustomEvent('edit-phrase', { detail: { id: phrase.id } }));
                return;
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const time = getTimeFromX(x, canvas.width, displayTimeRef.current);

        const baseline = canvas.height * 0.58;
        const lineSpacing = 60;

        if (isDragging && activePhraseId && onPhraseUpdate) {
            const phrase = phrases.find(p => p.id === activePhraseId);
            if (!phrase) return;

            if (dragMode === 'stretch-start') {
                onPhraseUpdate({ ...phrase, startTime: Math.min(time, phrase.endTime - 0.1) });
            } else if (dragMode === 'stretch-end') {
                onPhraseUpdate({ ...phrase, endTime: Math.max(time, phrase.startTime + 0.1) });
            } else if (dragMode === 'segment-edge' && draggingSegmentIdx !== null && draggingEdgeIdx !== null) {
                const ps = getXFromTime(phrase.startTime, canvas.width, displayTimeRef.current);
                const pe = getXFromTime(phrase.endTime, canvas.width, displayTimeRef.current);
                const pct = (x - ps) / (pe - ps);

                const segments = phrase.text.split('||');
                let offsets = [...(phrase.offsets || [])];
                if (offsets.length !== segments.length * 2) {
                    offsets = [];
                    for (let i = 0; i < segments.length; i++) {
                        const endPct = (i === segments.length - 1) ? 1.0 : (i + 0.9) / segments.length;
                        offsets.push(i / segments.length, endPct);
                    }
                }

                // Constraints: segments stay within 0..1 and don't overlap
                const idx = draggingSegmentIdx * 2 + draggingEdgeIdx;
                const min = idx > 0 ? offsets[idx - 1] + 0.01 : 0;
                const max = idx < offsets.length - 1 ? offsets[idx + 1] - 0.01 : 1;

                offsets[idx] = Math.max(min, Math.min(max, pct));
                onPhraseUpdate({ ...phrase, offsets });
            } else if (dragMode === 'move') {
                const duration = phrase.endTime - phrase.startTime;
                const newStart = time + dragOffset;

                const rawLine = (y - baseline) / lineSpacing + 1.5;
                const nearestLine = Math.max(0, Math.min(3, Math.round(rawLine)));

                onPhraseUpdate({
                    ...phrase, startTime: newStart, endTime: newStart + duration, line: nearestLine
                });
            }
        } else if (isDragging && dragMode === 'marker-move' && selectedMarkerId && onMarkerUpdate) {
            const marker = markers.find(m => m.id === selectedMarkerId);
            if (marker) {
                onMarkerUpdate({ ...marker, time: Math.max(0, time) });
            }
        } else if (isDraggingMiddle && onSeek) {
            const deltaX = x - middleDragStartX;
            const deltaTime = deltaX / pixelsPerSecond;
            const targetTime = Math.max(0, Math.min(duration, middleDragStartTime - deltaTime));

            displayTimeRef.current = targetTime;

            const now = performance.now();
            if (now - lastSeekTimeRef.current > 16) { // ~60 seeks/sec max, VideoPlayer guard will handle back-pressure
                onSeek(targetTime);
                lastSeekTimeRef.current = now;
                lastUserSeekTimeRef.current = now; // Mark as user seek
            }
        } else if (isDragging && isDraggingScrollbar && onSeek) {
            const pct = (x - 4) / (canvas.width - 8);
            const targetTime = Math.max(0, Math.min(duration, pct * duration));

            // UI Decoupling: Update band instantly
            displayTimeRef.current = targetTime;

            // Throttled Seek: Don't overload the video engine (max 60 seeks/sec)
            const now = performance.now();
            if (now - lastSeekTimeRef.current > 16) { // ~60fps seeking attempt
                onSeek(targetTime);
                lastSeekTimeRef.current = now;
                lastUserSeekTimeRef.current = now; // Mark as user seek
            }
        } else if (!isPlaying) {
            let found = null;
            for (const phrase of phrases) {
                const py = baseline + ((phrase.line ?? 1) - 1.5) * lineSpacing;
                const ps = getXFromTime(phrase.startTime, canvas.width, displayTimeRef.current);
                const pe = getXFromTime(phrase.endTime, canvas.width, displayTimeRef.current);
                // Expand hitbox vertically to the top (60px above, 20px below)
                if (y > py - 60 && y < py + 20 && x > ps - 20 && x < pe + 20) {
                    found = phrase.id; break;
                }
            }
            setActivePhraseId(found);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false); setDragMode(null);
        setDraggingSegmentIdx(null); setDraggingEdgeIdx(null);
        setIsDraggingScrollbar(false);
        setIsDraggingMiddle(false);
        isDraggingRef.current = false; // Allow sync again
        if (onInteractionEnd) onInteractionEnd();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!shortcuts) return;

        // Fix: If we are editing a phrase, or focused on an input, don't trigger global deletions
        if (editingPhraseId || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
            return;
        }

        // We need a React version of isShortcutPressed or use e.key directly
        const isDelete = e.key === 'Delete' || e.key === 'Backspace' || (shortcuts.deleteItem && (e.key === shortcuts.deleteItem || e.code === shortcuts.deleteItem));

        if (isDelete) {
            if (selectedMarkerId && onDeleteMarker) {
                onDeleteMarker(selectedMarkerId);
                setSelectedMarkerId(null);
            } else if (activePhraseId && onDeletePhrase) {
                onDeletePhrase(activePhraseId);
                setActivePhraseId(null);
            }
        }
    };

    // Precise wheel handler moved to useEffect for passive:false support
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (!onSeek) return;

            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            // Precise sensitivity: 1 notch (~100 units) = 1 frame
            const framesToMove = Math.max(1, Math.round(Math.abs(delta) / 100));
            const direction = delta > 0 ? 1 : -1;

            // Snap to grid for absolute precision using the project's actual FPS
            const currentFrame = Math.round(displayTimeRef.current * fps);
            const targetFrame = currentFrame + (direction * framesToMove);
            const targetTime = Math.max(0, Math.min(duration, targetFrame / fps));

            // V46: Wheel Stabilization Logic
            // Mark as wheeling to block external updates
            isWheelingRef.current = true;
            if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
            wheelTimeoutRef.current = setTimeout(() => {
                isWheelingRef.current = false;
            }, 200);

            // V130: Debounce the actual video seek to prevent rapid firing causing state jitter
            if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
            seekTimeoutRef.current = setTimeout(() => {
                onSeek(targetTime);
            }, 50); // 50ms implies ~20 updates per second, smooth but not overwhelming

            displayTimeRef.current = targetTime;
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        // Start interaction on wheel start (though wheel doesn't have a clear "end" without timeout, 
        // but for focus/sync it might be useful)
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [onSeek, duration, fps]);

    const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        if (!onDeleteMarker) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const hitSize = 15;

        const marker = markers.find(m => Math.abs(getXFromTime(m.time, canvas.width, displayTimeRef.current) - x) < hitSize);

        if (marker) {
            onDeleteMarker(marker.id);
            setSelectedMarkerId(null);
        }
    };

    return (
        <div
            className={`w-full h-64 border-t overflow-hidden relative shrink-0 transition-colors duration-300 ${isDark ? 'bg-zinc-950 border-zinc-800' : 'bg-[#fdfaf0] border-zinc-200'}`}
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <canvas
                ref={canvasRef}
                className={`w-full h-full cursor-${dragMode ? (dragMode === 'move' ? 'grabbing' : 'ew-resize') : (activePhraseId ? 'pointer' : 'default')}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
            />

            {/* Direct Editing Overlay */}
            {editingPhraseId && (
                <div
                    className="absolute z-50 flex items-center justify-center p-2 rounded-lg bg-zinc-950/80 backdrop-blur-sm border border-[#e11d48]/50 shadow-2xl"
                    style={{
                        left: getXFromTime(phrases.find(p => p.id === editingPhraseId)?.startTime || 0, canvasRef.current?.width || 0, displayTimeRef.current),
                        top: (canvasRef.current?.height || 300) * 0.58 + ((phrases.find(p => p.id === editingPhraseId)?.line ?? 1) - 1.5) * 60 - 30,
                        width: (getXFromTime(phrases.find(p => p.id === editingPhraseId)?.endTime || 0, canvasRef.current?.width || 0, displayTimeRef.current) - getXFromTime(phrases.find(p => p.id === editingPhraseId)?.startTime || 0, canvasRef.current?.width || 0, displayTimeRef.current)),
                        minWidth: '200px'
                    }}
                >
                    <input
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onFocus={(e) => {
                            const val = e.currentTarget.value;
                            e.currentTarget.setSelectionRange(val.length, val.length);
                        }}
                        onBlur={() => {
                            const phrase = phrases.find(p => p.id === editingPhraseId);
                            if (phrase && onPhraseUpdate) {
                                onPhraseUpdate({ ...phrase, text: editingValue });
                            }
                            setEditingPhraseId(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                                setEditingPhraseId(null);
                            }
                        }}
                        className="w-full bg-transparent border-none outline-none text-white font-bold text-center"
                        style={{ fontSize: fontSize + 4 }}
                    />
                </div>
            )}
        </div>
    );
});

const getContrastColor = (hexcolor: string) => {
    if (!hexcolor || hexcolor.startsWith('rgb')) return '#ffffff'; // Fallback
    const r = parseInt(hexcolor.substring(1, 3), 16);
    const g = parseInt(hexcolor.substring(3, 5), 16);
    const b = parseInt(hexcolor.substring(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
};

/**
 * Adjusts a HEX color by a percentage.
 * @param hex HEX color string (e.g. #ffffff)
 * @param amount Percentage to adjust (-100 to 100)
 */
RhythmicBand.displayName = 'RhythmicBand';
export default RhythmicBand;
