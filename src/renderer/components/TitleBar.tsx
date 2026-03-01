import logo from '../../assets/vocap_logo.png';
import { Minus, Square, X } from 'lucide-react';
import { isWebEnvironment } from '../src/services/AppBridge';

const TitleBar: React.FC = () => {
    const minimize = () => {
        if (!isWebEnvironment) (window as any).electron.ipcRenderer.send('window-minimize');
    };

    const maximize = () => {
        if (!isWebEnvironment) (window as any).electron.ipcRenderer.send('window-maximize');
    };

    const close = () => {
        if (!isWebEnvironment) (window as any).electron.ipcRenderer.send('window-close');
    };

    return (
        <div
            className="h-8 w-full bg-[#05070a] flex items-center justify-between select-none border-b border-white/5 z-[1000] relative"
            style={{ WebkitAppRegion: 'drag' } as any}
        >
            <div className="flex items-center gap-2 pl-4 pointer-events-none">
                <img src={logo} className="w-4 h-4" alt="logo" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">VOCAP</span>
            </div>

            {!isWebEnvironment && (
                <div className="flex items-center h-full no-drag" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        onClick={minimize}
                        className="h-full w-12 flex items-center justify-center text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
                    >
                        <Minus size={14} />
                    </button>
                    <button
                        onClick={maximize}
                        className="h-full w-12 flex items-center justify-center text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
                    >
                        <Square size={12} />
                    </button>
                    <button
                        onClick={close}
                        className="h-full w-12 flex items-center justify-center text-zinc-500 hover:bg-rose-600 hover:text-white transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default TitleBar;
