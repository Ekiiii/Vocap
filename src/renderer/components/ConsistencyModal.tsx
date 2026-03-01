import React from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import type { Phrase, Character } from '../App';

interface ValidationIssue {
    id: string;
    type: 'error' | 'warning';
    message: string;
    phraseId?: string;
    time?: number;
}

interface ConsistencyModalProps {
    phrases: Phrase[];
    characters: Character[];
    onClose: () => void;
    onSeek: (time: number) => void;
}

const ConsistencyModal: React.FC<ConsistencyModalProps> = ({ phrases, characters, onClose, onSeek }) => {
    const issues: ValidationIssue[] = [];

    // 1. Check for Empty Phrases
    phrases.forEach(p => {
        if (!p.text || p.text.trim() === "") {
            issues.push({
                id: `empty-${p.id}`,
                type: 'warning',
                message: 'Phrase vide détectée.',
                phraseId: p.id,
                time: p.startTime
            });
        }
    });

    // 2. Check for Overlaps (Same Character)
    const sortedByChar = [...phrases].sort((a, b) => a.characterId.localeCompare(b.characterId) || a.startTime - b.startTime);
    for (let i = 0; i < sortedByChar.length - 1; i++) {
        const current = sortedByChar[i];
        const next = sortedByChar[i + 1];
        if (current.characterId === next.characterId && current.endTime > next.startTime) {
            issues.push({
                id: `overlap-${current.id}-${next.id}`,
                type: 'error',
                message: `Chevauchement entre deux phrases du même personnage.`,
                phraseId: next.id,
                time: next.startTime
            });
        }
    }

    // 3. Check for Orphan Phrases (Character deleted)
    phrases.forEach(p => {
        if (!characters.find(c => c.id === p.characterId)) {
            issues.push({
                id: `orphan-${p.id}`,
                type: 'error',
                message: 'Personnage assigné inexistant.',
                phraseId: p.id,
                time: p.startTime
            });
        }
    });

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-[#0e0e10] border border-[#1f1f23] w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                <div className="p-6 border-b border-[#1f1f23] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="text-rose-500" size={20} />
                        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Validateur de Cohérence</h2>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {issues.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-4">
                            <CheckCircle size={48} className="text-emerald-500 opacity-20" />
                            <p className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Aucun problème détecté !</p>
                            <p className="text-[9px] text-zinc-600 text-center max-w-[200px]">Votre projet semble prêt pour l'exportation.</p>
                        </div>
                    ) : (
                        issues.map(issue => (
                            <div
                                key={issue.id}
                                onClick={() => { if (issue.time !== undefined) { onSeek(issue.time); onClose(); } }}
                                className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${issue.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 hover:border-rose-500/40' : 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40'
                                    }`}
                            >
                                <div className={`mt-0.5 ${issue.type === 'error' ? 'text-rose-500' : 'text-amber-500'}`}>
                                    {issue.type === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-[11px] font-bold text-zinc-200">{issue.message}</p>
                                    {issue.time !== undefined && (
                                        <p className="text-[9px] text-zinc-500 font-mono mt-1">
                                            Time: {Math.floor(issue.time / 60)}:{(issue.time % 60).toFixed(2).padStart(5, '0')}
                                        </p>
                                    )}
                                </div>
                                <div className="text-[8px] font-black uppercase tracking-widest text-zinc-600 self-center">
                                    VOIR
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 bg-[#050505] border-t border-[#1f1f23]">
                    <p className="text-[9px] text-zinc-500 text-center uppercase tracking-widest leading-relaxed">
                        {issues.length > 0
                            ? `${issues.length} alerte(s) à vérifier avant l'exportation finale.`
                            : "Tout est conforme."}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ConsistencyModal;
