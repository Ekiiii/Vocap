import React, { useState } from 'react';
import { Trash2, Type, Plus, Play, ChevronDown, ChevronUp } from 'lucide-react';

interface Phrase {
    id: string;
    startTime: number;
    endTime: number;
    text: string;
    characterId: string;
    character?: string; // Display name (optional)
    color: string;
    calligraphy?: number;
    isOffScreen?: boolean;
    line?: number;
    intent?: string;
    words?: { word: string; start: number; end: number }[];
}

interface Character {
    id: string;
    name: string;
    color: string;
}

interface DialogueEditorProps {
    phrases: Phrase[];
    characters: Character[];
    selectedCharacterId: string;
    onSelectCharacter: (id: string) => void;
    onAdd: (initialData?: Partial<Phrase>) => void;
    onRemove: (id: string) => void;
    onUpdate: (phrase: any, isTyping?: boolean) => void;
    currentTime: number;
    onSeek: (time: number) => void;
    theme?: 'dark' | 'light';
}

const DialogueEditor: React.FC<DialogueEditorProps> = ({
    phrases,
    characters,
    selectedCharacterId,
    onSelectCharacter,
    onAdd,
    onRemove,
    onUpdate,
    currentTime,
    onSeek,
    theme = 'dark'
}) => {
    const isDark = theme === 'dark';
    const [expandedPhrases, setExpandedPhrases] = useState<Set<string>>(new Set());

    const togglePhrase = (id: string) => {
        const next = new Set(expandedPhrases);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedPhrases(next);
    };

    const listRef = React.useRef<HTMLDivElement>(null);
    const phraseRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
    const isUserScrollingRef = React.useRef(false);
    const lastUserScrollTimeRef = React.useRef(0);

    const [localTime, setLocalTime] = React.useState(currentTime);
    const lastActiveIdRef = React.useRef<string | null>(null);

    const phrasesRef = React.useRef(phrases);
    React.useEffect(() => { phrasesRef.current = phrases; }, [phrases]);

    React.useEffect(() => {
        const handleUpdate = (e: any) => {
            const time = e.detail.time;
            setLocalTime(time);

            // V69-Fix: Performance Throttle - Only check for active phrase if not user scrolling
            if (isUserScrollingRef.current) {
                const now = Date.now();
                if (now - lastUserScrollTimeRef.current > 3000) {
                    isUserScrollingRef.current = false;
                } else {
                    return;
                }
            }

            const active = phrasesRef.current.find(p => time >= p.startTime && time <= p.endTime);
            if (active && active.id !== lastActiveIdRef.current) {
                const target = phraseRefs.current[active.id];
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    lastActiveIdRef.current = active.id;
                }
            } else if (!active) {
                lastActiveIdRef.current = null;
            }
        };
        window.addEventListener('time-update', handleUpdate);
        return () => window.removeEventListener('time-update', handleUpdate);
    }, []); // Stable listener

    const handleScroll = () => {
        isUserScrollingRef.current = true;
        lastUserScrollTimeRef.current = Date.now();
    };

    // Edit phrase event listener (double-click from band)
    React.useEffect(() => {
        const handleEdit = (e: any) => {
            const id = e.detail.id;
            const next = new Set(expandedPhrases);
            next.add(id);
            setExpandedPhrases(next);
            setTimeout(() => {
                phraseRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
        };
        window.addEventListener('edit-phrase', handleEdit);
        return () => window.removeEventListener('edit-phrase', handleEdit);
    }, [expandedPhrases]);

    // Sync localTime with currentTime prop when it changes (e.g. on pause/seek)
    React.useEffect(() => {
        setLocalTime(currentTime);
    }, [currentTime]);

    return (
        <div className={`w-full border-l flex flex-col shrink-0 transition-colors duration-300 bg-[#05070a] border-white/5`}>
            {/* Character filtering and management removed as it is now in the main sidebar */}

            {/* QUICK DRAFT ENTRY - Stitch Style */}
            <div className="p-5">
                <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saisie Rapide</p>
                </div>
                <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <select
                                value={selectedCharacterId}
                                onChange={(e) => onSelectCharacter(e.target.value)}
                                className="w-full h-10 bg-black/40 border border-white/5 rounded-[12px] px-3 text-[11px] font-bold uppercase outline-none focus:border-[#e11d48] transition-all appearance-none text-slate-300"
                            >
                                {characters.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                        </div>
                        <button
                            onClick={() => onAdd()}
                            className="h-10 px-4 bg-[#e11d48] hover:brightness-110 rounded-[12px] text-white font-bold transition-all active:scale-95 flex items-center justify-center"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                    <input
                        type="text"
                        placeholder="Nouveau dialogue..."
                        spellCheck="true"
                        className="w-full h-12 bg-black/60 border border-white/10 rounded-[12px] px-4 text-sm font-medium outline-none focus:border-[#e11d48] shadow-inner transition-all placeholder:text-slate-600 text-white"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                if (val.trim()) {
                                    onAdd({
                                        text: val,
                                        startTime: localTime,
                                        endTime: localTime + 2,
                                        characterId: selectedCharacterId,
                                    });
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }
                        }}
                    />
                </div>
            </div>

            {/* Phrases List */}
            <div className="px-5 pt-4 pb-2 flex items-center justify-between shrink-0">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                    <Type size={12} /> Séquences
                </h2>
                <span className="text-[10px] font-mono text-zinc-600">{phrases.length} PHRASES</span>
            </div>

            <div
                className="flex-1 overflow-y-auto pr-2 space-y-4 p-4"
                onScroll={handleScroll}
                ref={listRef}
            >
                {phrases
                    .sort((a, b) => a.startTime - b.startTime)
                    .map((phrase) => (
                        <div
                            key={phrase.id}
                            ref={el => { phraseRefs.current[phrase.id] = el; }}
                            className={`p-4 rounded-xl border transition-all ${localTime >= phrase.startTime && localTime <= phrase.endTime
                                ? 'bg-red-600/10 border-red-600/50 shadow-[0_0_15px_rgba(220,38,38,0.1)]'
                                : (isDark ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200 shadow-sm')
                                }`}
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 w-full mr-2">
                                    <select
                                        value={phrase.characterId}
                                        onChange={(e) => onUpdate({ ...phrase, characterId: e.target.value, color: characters.find(c => c.id === e.target.value)?.color || phrase.color })}
                                        className={`border text-[10px] font-bold uppercase p-1 rounded w-full outline-none focus:border-red-600 ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-400' : 'bg-white border-zinc-200 text-zinc-600'}`}
                                    >
                                        {characters.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => onUpdate({ ...phrase, isOffScreen: !phrase.isOffScreen })}
                                        className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold transition-colors ${phrase.isOffScreen
                                            ? (isDark ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-white')
                                            : (isDark ? 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200')}`}
                                        title="Activer/Désactiver le souligné (Hors-champ)"
                                    >
                                        U
                                    </button>
                                    <button
                                        onClick={() => onRemove(phrase.id)}
                                        className="p-1 hover:bg-zinc-800 rounded text-zinc-600 hover:text-red-500 transition-colors shrink-0"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Line Selector */}
                            <div className="flex gap-1 mb-4">
                                {[0, 1, 2, 3].map(lineIdx => (
                                    <button
                                        key={lineIdx}
                                        onClick={() => onUpdate({ ...phrase, line: lineIdx })}
                                        className={`flex-1 py-1 rounded text-[8px] font-bold border transition-all ${phrase.line === lineIdx || (phrase.line === undefined && lineIdx === 2)
                                            ? (isDark ? 'border-white bg-white/10 text-white' : 'border-zinc-900 bg-zinc-900/10 text-zinc-900')
                                            : (isDark ? 'border-zinc-800 text-zinc-600 hover:border-zinc-700' : 'border-zinc-200 text-zinc-400 hover:border-zinc-300')
                                            }`}
                                    >
                                        L{lineIdx + 1}
                                    </button>
                                ))}
                            </div>

                            <div className="relative space-y-2">
                                <input
                                    type="text"
                                    placeholder="Texte du dialogue..."
                                    spellCheck="true"
                                    value={phrase.text}
                                    onChange={(e) => onUpdate({ ...phrase, text: e.target.value }, true)}
                                    className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${isDark ? 'bg-zinc-950 border-zinc-800 focus:border-red-600 text-white' : 'bg-white border-zinc-200 focus:border-red-600 text-zinc-900'}`}
                                />
                                <div className="flex items-center gap-2">
                                    <div className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded ${isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-100 text-zinc-400'}`}>
                                        Intention
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Ex: Crié, Essoufflé..."
                                        value={phrase.intent || ''}
                                        onChange={(e) => onUpdate({ ...phrase, intent: e.target.value }, true)}
                                        className={`flex-1 border-b text-[10px] outline-none transition-colors px-1 ${isDark ? 'bg-transparent border-zinc-800 focus:border-red-600 text-zinc-400' : 'bg-transparent border-zinc-200 focus:border-red-600 text-zinc-600'}`}
                                    />
                                </div>
                            </div>

                            {/* Collapsible Details */}
                            {expandedPhrases.has(phrase.id) && (
                                <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className={`grid grid-cols-2 gap-4 text-[10px] font-mono mb-4 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        <div className="space-y-1">
                                            <p className="uppercase tracking-tighter">Début (s)</p>
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={phrase.startTime}
                                                onChange={(e) => onUpdate({ ...phrase, startTime: parseFloat(e.target.value) })}
                                                className={`bg-transparent border-b w-full outline-none ${isDark ? 'border-zinc-800 focus:border-red-600' : 'border-zinc-200 focus:border-red-600 text-zinc-900'}`}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="uppercase tracking-tighter">Fin (s)</p>
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={phrase.endTime}
                                                onChange={(e) => onUpdate({ ...phrase, endTime: parseFloat(e.target.value) })}
                                                className={`bg-transparent border-b w-full outline-none ${isDark ? 'border-zinc-800 focus:border-red-600' : 'border-zinc-200 focus:border-red-600 text-zinc-900'}`}
                                            />
                                        </div>
                                    </div>

                                    {/* Calligraphie (Stretching) */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-[10px] uppercase font-bold text-zinc-600">
                                            <span>Calligraphie</span>
                                            <span>{((phrase.calligraphy || 1) * 100).toFixed(0)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.5"
                                            max="3.0"
                                            step="0.05"
                                            value={phrase.calligraphy || 1}
                                            onChange={(e) => onUpdate({ ...phrase, calligraphy: parseFloat(e.target.value) })}
                                            className="w-full h-1 bg-zinc-800 appearance-none rounded-full accent-zinc-500 hover:accent-red-600 transition-colors cursor-pointer"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="mt-4 flex gap-2">
                                <button
                                    onClick={() => onSeek(phrase.startTime)}
                                    className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] text-zinc-300 hover:text-white uppercase font-bold tracking-widest transition-colors flex items-center justify-center gap-2"
                                >
                                    <Play size={10} fill="currentColor" /> Aller à
                                </button>
                                <button
                                    onClick={() => togglePhrase(phrase.id)}
                                    className={`w-8 flex items-center justify-center rounded transition-colors ${expandedPhrases.has(phrase.id)
                                        ? (isDark ? 'bg-zinc-800 text-white' : 'bg-zinc-200 text-zinc-900')
                                        : (isDark ? 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600')
                                        }`}
                                >
                                    {expandedPhrases.has(phrase.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                            </div>
                        </div>
                    ))}
                {phrases.length === 0 && (
                    <div className="h-64 flex flex-col items-center justify-center text-zinc-600 text-center px-4">
                        <Type size={32} className="mb-3 opacity-20" />
                        <p className="text-xs italic">Aucune phrase dans le projet.<br />Utilisez le bouton + pour commencer.</p>
                    </div>
                )}
            </div>
        </div >
    );
};

export default DialogueEditor;
