import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, MapPin, ZoomIn, ZoomOut, PlusSquare,
  ChevronDown,
  Download,
  Scissors,
  RotateCcw,
  FolderOpen,
  FileVideo,
  Save,
  Zap,
  Layout,
  RefreshCw,
  Users,
  Trash2,
  FileText,
  MessageSquare,
  Clock,
  LogOut,
  Type,
  X,
  AlertTriangle,
  Monitor,
  Video,
  Cpu,
  Music,
  Volume1,
  VolumeX
} from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import RhythmicBand from './components/RhythmicBand';
import DialogueEditor from './components/DialogueEditor';
import MiniMap from './components/MiniMap';
import ConsistencyModal from './components/ConsistencyModal';
import SecondaryVideo from './components/SecondaryVideo';
import TitleBar from './components/TitleBar';
import AudioTrackPlayer from './components/AudioTrackPlayer';
import { AppBridge } from './src/services/AppBridge';
import { SubtitleParser } from './src/utils/SubtitleParser';

// V69 - EMERALD PIVOT: WebGPU IA Sovereignty
// @ts-ignore
import { pipeline, env } from '@xenova/transformers';

export interface Phrase {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  characterId: string;
  color: string;
  calligraphy?: number;
  isOffScreen?: boolean;
  line?: number;
  offsets?: number[];
  intent?: string;
  words?: { word: string; start: number; end: number }[];
}

export interface Marker {
  id: string;
  time: number;
  type?: 'scene' | 'loop';
}

export interface Character {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_SHORTCUTS = {
  playPause: 'Space',
  stepForward: 'Alt+ArrowRight',
  stepBackward: 'Alt+ArrowLeft',
  prevPhrase: 'F9',
  nextPhrase: 'F10',
  prevMarker: 'F11',
  nextMarker: 'F12',
  volUp: 'Control++',
  volDown: 'Control+-',
  mute: 'Control+*',
  undo: 'Control+z',
  redo: 'Control+y',
  deleteItem: 'Delete', // Unified delete command
  reversePlay: 'j',
  addSceneMarker: 'Alt+s',
  addLoopMarker: 'Alt+l',
  zoomIn: '+',
  zoomOut: '-',
  fullscreen: 'Alt+Enter',
  createPhrase: 'Enter',
  jumpToStart: 'Home',
  jumpToEnd: 'End'
};

const SHORTCUT_LABELS: Record<string, string> = {
  playPause: 'Lecture / Pause',
  stepForward: 'Image Suivante',
  stepBackward: 'Image Précédente',
  prevPhrase: 'Phrase Précédente',
  nextPhrase: 'Phrase Suivante',
  prevMarker: 'Marqueur Précédent',
  nextMarker: 'Marqueur Suivant',
  volUp: 'Volume +',
  volDown: 'Volume -',
  mute: 'Muet',
  undo: 'Annuler (Undo)',
  redo: 'Rétablir (Redo)',
  deleteItem: 'Supprimer Élément (Phrase / Marqueur)', // Unified label
  reversePlay: 'Lecture Arrière',
  addSceneMarker: 'Nouveau Marqueur Plan',
  addLoopMarker: 'Nouveau Marqueur Boucle',
  zoomIn: 'Zoom Avant',
  zoomOut: 'Zoom Arrière',
  fullscreen: 'Plein Écran',
  createPhrase: 'Créer une phrase',
  jumpToStart: 'Début du projet',
  jumpToEnd: 'Fin du projet'
};

const SHORTCUT_CATEGORIES = [
  {
    title: 'Lecture & Vidéo',
    keys: ['playPause', 'reversePlay', 'stepForward', 'stepBackward', 'jumpToStart', 'jumpToEnd', 'fullscreen']
  },
  {
    title: 'Navigation',
    keys: ['prevPhrase', 'nextPhrase', 'prevMarker', 'nextMarker']
  },
  {
    title: 'Édition & Projet',
    keys: ['createPhrase', 'deleteItem', 'addSceneMarker', 'addLoopMarker', 'undo', 'redo']
  },
  {
    title: 'Interface & Son',
    keys: ['volUp', 'volDown', 'mute', 'zoomIn', 'zoomOut']
  }
];

const isShortcutPressed = (e: KeyboardEvent, shortcutStr: string) => {
  if (!shortcutStr) return false;
  const parts = shortcutStr.split('+');
  const mainKey = parts.pop()?.toLowerCase();
  const hasControl = parts.some(p => p.toLowerCase() === 'control' || p.toLowerCase() === 'ctrl');
  const hasAlt = parts.some(p => p.toLowerCase() === 'alt');
  const hasShift = parts.some(p => p.toLowerCase() === 'shift');
  const hasMeta = parts.some(p => p.toLowerCase() === 'meta' || p.toLowerCase() === 'command');
  const keyMatch = e.key.toLowerCase() === mainKey || e.code.toLowerCase() === mainKey;
  return keyMatch && e.ctrlKey === hasControl && e.altKey === hasAlt && e.shiftKey === hasShift && e.metaKey === hasMeta;
};

const App = () => {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Helper to ensure file:// protocol on Windows for local paths
  const ensureFileProtocol = (path: string) => {
    if (!path) return path;
    if (path.startsWith('file://') || path.startsWith('blob:') || path.startsWith('http') || path.startsWith('data:')) {
      return path;
    }
    const fixedPath = path.replace(/\\/g, '/');
    return `file:///${fixedPath.startsWith('/') ? fixedPath.slice(1) : fixedPath}`;
  };
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [characters, setCharacters] = useState<Character[]>([
    { id: '1', name: 'Perso 1', color: '#ffffff' },
    { id: '2', name: 'Perso 2', color: '#ef4444' }
  ]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('1');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isBundling, setIsBundling] = useState(false);
  const [bundleProgress, setBundleProgress] = useState({ percent: 0, message: '' });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(400);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [exportETA, setExportETA] = useState<string | null>(null);
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'rendering' | 'baking' | 'finishing' | 'separating' | 'proxying'>('idle');

  // V31: UI Heartbeat to keep telemetry (elapsed time, ETA) updating in real-time
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    let interval: any;
    if (isExporting) {
      interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isExporting]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('vocap_theme') as 'dark' | 'light') || 'dark');
  const [projectSessionId, setProjectSessionId] = useState(0);
  // Use projectSessionId in a dummy way to avoid lint warning if needed, 
  // though it's useful for forcing child component resets.
  console.log("Current Project Session:", projectSessionId);
  const isDark = theme === 'dark';
  const [fontSize, setFontSize] = useState(20);
  const [fontFamily, setFontFamily] = useState(localStorage.getItem('vocap_font') || 'Outfit');
  const [bandBackgroundColor, setBandBackgroundColor] = useState(localStorage.getItem('vocap_band_bg') || '#18181b');

  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('vocap_favorites');
    return saved ? JSON.parse(saved) : ['(RIRE)', '(SOUPIRE)', '[EFFORT]', '(OFF)', '(Bruitage)'];
  });

  useEffect(() => {
    localStorage.setItem('vocap_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Export Settings
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRes, setExportRes] = useState<'720p' | '1080p'>('1080p');
  const [exportFps, setExportFps] = useState<number>(60);
  const [exportQuality, setExportQuality] = useState<'low' | 'medium' | 'high' | 'ultra' | 'lossless'>('medium');
  const [exportEncoder, setExportEncoder] = useState<string>('auto');

  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const isExportCancelledRef = useRef(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [proxyPath, setProxyPath] = useState<string | null>(null);

  const [isSecondaryWindow] = useState(window.location.hash === '#video');

  const [isConsistencyModalOpen, setIsConsistencyModalOpen] = useState(false);
  const [projectVersions, setProjectVersions] = useState<{ id: string, name: string, time: number, data: any }[]>(() => {
    const saved = localStorage.getItem('vocap_project_versions');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('vocap_project_versions', JSON.stringify(projectVersions));
  }, [projectVersions]);

  const createCheckpoint = (name: string) => {
    const { phrases, markers, characters, videoSrc } = stateRef.current;
    const data = { phrases, markers, characters, videoSrc };
    const newVersion = {
      id: crypto.randomUUID(),
      name,
      time: Date.now(),
      data
    };
    setProjectVersions(prev => [newVersion, ...prev].slice(0, 20)); // Keep last 20
  };

  const restoreVersion = (version: any) => {
    if (!confirm("Voulez-vous vraiment restaurer cette version ? Les modifications non sauvegardées seront perdues.")) return;
    setPhrases(version.data.phrases || []);
    setMarkers(version.data.markers || []);
    setCharacters(version.data.characters || []);
    if (version.data.videoSrc) setVideoSrc(ensureFileProtocol(version.data.videoSrc));
    setProjectSessionId(s => s + 1);
  };
  const saveShortcuts = (newShortcuts: typeof shortcuts) => {
    setShortcuts(newShortcuts);
    localStorage.setItem('vocap_shortcuts', JSON.stringify(newShortcuts));
  };

  const [isProxyMode, setIsProxyMode] = useState(false);
  const [proxyProgress, setProxyProgress] = useState(0);
  const [isGeneratingProxy, setIsGeneratingProxy] = useState(false);
  const [isReversePlaying, setIsReversePlaying] = useState(false);
  const [videoFps, setVideoFps] = useState<number>(25);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(localStorage.getItem('vocap_current_path') || null);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [isDetectingScenes, setIsDetectingScenes] = useState(false);
  const [sceneDetectionProgress, setSceneDetectionProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'dialogue' | 'characters' | 'project' | 'favorites' | 'audio'>('dialogue');
  const [newFavoriteText, setNewFavoriteText] = useState('');
  const [audioTracks, setAudioTracks] = useState<{ id: string, name: string, path: string, volume: number, isMuted: boolean, startTime?: number }[]>([]);
  const [nativeAudioVolume, setNativeAudioVolume] = useState(1);
  const [nativeAudioMuted, setNativeAudioMuted] = useState(false);
  const [selectedExportAudioPath, setSelectedExportAudioPath] = useState<string | null>(null);
  const [availableEncoders, setAvailableEncoders] = useState<Record<string, boolean>>({});

  // Sync VideoPlayer volume with native states
  useEffect(() => {
    if (videoPlayerRef.current) {
      videoPlayerRef.current.setVolume(nativeAudioMuted ? 0 : nativeAudioVolume);
    }
  }, [nativeAudioVolume, nativeAudioMuted]);

  const handleAddAudioTrack = async () => {
    const path = await AppBridge.selectAudio();
    if (path) {
      const fileName = path.split(/[\\/]/).pop() || 'Nouvelle Piste';
      setAudioTracks(prev => [...prev, {
        id: crypto.randomUUID(),
        name: fileName,
        path: path,
        volume: 1,
        isMuted: false
      }]);
    }
  };

  const handleImportSubtitle = async () => {
    const path = await AppBridge.selectSubtitle();
    if (!path) return;

    try {
      const response = await fetch(`file:///${path.replace(/\\/g, '/')}`);
      const content = await response.text();
      let imported: any[] = [];

      if (path.toLowerCase().endsWith('.srt')) {
        imported = SubtitleParser.parseSRT(content);
      } else if (path.toLowerCase().endsWith('.xml')) {
        imported = SubtitleParser.parseXML(content);
      }

      if (imported.length > 0) {
        const characterId = characters[0]?.id || '1';
        const newPhrases = imported.map(item => ({
          id: crypto.randomUUID(),
          startTime: item.startTime,
          endTime: item.endTime,
          text: item.text,
          characterId,
          color: characters[0]?.color || '#ffffff',
          line: 2
        }));

        updatePhrases(prev => [...prev, ...newPhrases].sort((a, b) => a.startTime - b.startTime));
        alert(`${newPhrases.length} phrases importées avec succès !`);
      }
    } catch (e) {
      console.error("Import error:", e);
      alert("Erreur lors de l'importation du fichier.");
    }
  };


  const [availableFonts, setAvailableFonts] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('vocap_fonts') || '[]');
    } catch {
      return [];
    }
  });

  // INITIALIZATION: Load settings, fonts, and version
  useEffect(() => {
    // 1. Fetch system fonts
    const fetchFonts = async () => {
      try {
        const fonts = await AppBridge.getSystemFonts();
        if (fonts && fonts.length > 0) {
          setAvailableFonts(fonts);
          localStorage.setItem('vocap_fonts', JSON.stringify(fonts));
        }
      } catch (err) {
        console.error("Failed to load system fonts", err);
      }
    };
    fetchFonts();

    // 2. Get app version
    window.electron.ipcRenderer.invoke('get-version')
      .then((v: string) => setAppVersion(v))
      .catch((err: any) => console.error('Failed to get app version:', err));

    // 3. Load shortcuts
    const savedShortcuts = localStorage.getItem('vocap_shortcuts');
    if (savedShortcuts) {
      try { setShortcuts({ ...DEFAULT_SHORTCUTS, ...JSON.parse(savedShortcuts) }); } catch (e) { console.error(e); }
    }

    // 4. AUTO-RELOAD LAST PROJECT (V141)
    const lastProject = localStorage.getItem('vocap_current_path');
    if (lastProject) {
      console.log('[Startup] Auto-reloading last project:', lastProject);
      AppBridge.loadProjectPath(lastProject).then(result => {
        if (result?.data) {
          const { data, path } = result;
          setPhrases(data.phrases || []);
          setCharacters(data.characters || [{ id: '1', name: 'Perso 1', color: '#ffffff' }, { id: '2', name: 'Perso 2', color: '#ef4444' }]);
          setMarkers(data.markers || []);
          if (data.audioTracks) setAudioTracks(data.audioTracks);
          if (data.videoSrc) {
            const v = ensureFileProtocol(data.videoSrc);
            setVideoSrc(v);
            AppBridge.getVideoMetadata(v).then(m => {
              if (m?.fps) setVideoFps(m.fps);
              if (m?.duration) setDuration(m.duration);
            });
          }
          if (path) {
            setCurrentProjectPath(path);
          }
          setProjectSessionId(s => s + 1);
        }
      }).catch(err => console.error('[Startup] Failed to auto-reload project:', err));
    }

    // 5. Fetch available hardware encoders
    window.electron.ipcRenderer.invoke('get-available-encoders')
      .then((res: Record<string, boolean>) => {
        setAvailableEncoders(res);
      })
      .catch((err: any) => console.error('Failed to get encoders:', err));
  }, []);

  // AI & GPU Settings (V66)
  // @ts-ignore
  const [useGpu, setUseGpu] = useState<boolean>(() => localStorage.getItem('vocap_use_gpu') === 'true');


  // V69-Fix: Memoize combined data to stop the render storm
  const memoizedPhrases = useMemo(() => {
    return phrases.map(p => ({
      ...p,
      character: characters.find(c => c.id === p.characterId)?.name || '?'
    }));
  }, [phrases, characters]);

  // Refs for zero-latency shortcut access
  const stateRef = useRef({
    isPlaying,
    isReversePlaying,
    currentTime,
    phrases,
    markers,
    shortcuts,
    characters,
    selectedCharacterId,
    fontSize,
    fontFamily,
    theme,
    videoSrc
  });

  useEffect(() => {
    stateRef.current = {
      isPlaying, isReversePlaying, currentTime, phrases, markers, shortcuts, characters, selectedCharacterId,
      fontSize, fontFamily, theme, videoSrc
    };
  }, [isPlaying, isReversePlaying, currentTime, phrases, markers, shortcuts, characters, selectedCharacterId, fontSize, fontFamily, theme, videoSrc]);

  useEffect(() => {
    localStorage.setItem('vocap_use_gpu', String(useGpu));
  }, [useGpu]);

  // AUTOSAVE & SILENT BACKUP LOGIC
  const lastAutosaveRef = useRef(Date.now());
  const lastBackupRef = useRef(Date.now());
  const hasUnsavedChangesRef = useRef(false);
  const hasCheckedBackupRef = useRef(false); // V126: Ensure recovery only runs once at startup

  useEffect(() => {
    hasUnsavedChangesRef.current = true;
  }, [phrases, markers, characters]);

  // 1. SILENT RECOVERY (Run ONCE at Startup)
  useEffect(() => {
    const checkRecovery = async () => {
      if (hasCheckedBackupRef.current) return;
      hasCheckedBackupRef.current = true;

      const backup = await AppBridge.checkBackup();
      // Only auto-restore if we have a backup and the current state is clean (initial load)
      if (backup && backup.data && phrases.length === 0 && !videoSrc) {
        console.log('[Recovery] Silently restoring backup from', new Date(backup.time).toLocaleTimeString());
        setPhrases(backup.data.phrases || []);
        setCharacters(backup.data.characters || []);
        setMarkers(backup.data.markers || []);
        if (backup.data.videoSrc) setVideoSrc(ensureFileProtocol(backup.data.videoSrc));
        const lastSavePath = localStorage.getItem('vocap_current_path');
        if (lastSavePath) setCurrentProjectPath(lastSavePath);
        setProjectSessionId(s => s + 1);
      }
    };
    const timer = setTimeout(checkRecovery, 1000);
    return () => clearTimeout(timer);
  }, []); // Empty dependency array = Startup only

  // 2. AUTO-SAVE & BACKUP TIMER (Scoped to project path changes)
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      const { phrases, markers, characters, videoSrc } = stateRef.current;
      const data = { phrases, markers, characters, audioTracks, videoSrc, version: appVersion };

      // Safety Backup (Every 2 minutes) - Always silent
      if (now - lastBackupRef.current > 120000 && hasUnsavedChangesRef.current) {
        const success = await AppBridge.backupProject(data);
        if (success) {
          lastBackupRef.current = now;
          // Clean up old legacy localStorage backup while we're at it
          localStorage.removeItem('vocap_autosave');
        }
      }

      // Official Autosave (Every 5 minutes if project is already saved) - Now silent
      if (now - lastAutosaveRef.current > 300000 && hasUnsavedChangesRef.current && currentProjectPath) {
        const success = await AppBridge.saveProjectSilent(data, currentProjectPath);
        if (success) {
          lastAutosaveRef.current = now;
          hasUnsavedChangesRef.current = false;
          // Removed setShowSaveToast(true) for imperceptible experience
        }
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [currentProjectPath]);

  // V140: Bundle Project Progress listener
  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on('bundle-progress', (_: any, data: { percent: number, message: string }) => {
      setBundleProgress(data);
    });
    return () => {
      if (removeListener) removeListener();
    };
  }, []);

  const handleBundleProject = async () => {
    if (isBundling) return;

    // Auto-save before bundling to ensure data is fresh
    const projectData = {
      phrases,
      markers,
      characters,
      videoSrc: videoSrc || null,
      version: appVersion
    };

    setIsBundling(true);
    setBundleProgress({ percent: 0, message: 'Démarrage du packaging...' });

    try {
      const result = await AppBridge.bundleProject(projectData, videoSrc, audioTracks);
      if (result.success) {
        alert(`📦 Projet packagé avec succès !\n\nL'archive est disponible à :\n${result.path}`);
      } else if (result.error !== 'Annulé') {
        alert(`❌ Échec du packaging : ${result.error}`);
      }
    } catch (err: any) {
      console.error('Bundle error:', err);
      alert('Erreur lors de la création du bundle.');
    } finally {
      setIsBundling(false);
      setBundleProgress({ percent: 0, message: '' });
    }
  };





  const currentTimeRef = useRef(0);

  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'>('idle');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const isManualUpdateCheckRef = useRef(false);
  const [appVersion, setAppVersion] = useState<string>('0.0.0');
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);
  const videoPlayerRef = useRef<{
    seek: (time: number) => void,
    getCurrentTime: () => number,
    getVideoElement: () => HTMLVideoElement | null,
    setVolume: (v: number) => void,
    getVolume: () => number,
    toggleMute: () => void,
    togglePlay: () => void
  }>(null);
  const rhythmicBandRef = useRef<{
    captureFrame: (videoElement?: HTMLVideoElement | null) => string | null,
    setExportResolution: (w: number, h: number) => void,
    forceRender: (time: number, ppsOverride?: number) => void,
    prepareExportStrip: (onProgress?: (pct: number) => void, ppsOverride?: number) => Promise<void>
  }>(null);

  // History Stack
  const historyRef = useRef<{ phrases: Phrase[]; characters: Character[]; markers: Marker[]; fontSize?: number; fontFamily?: string; theme?: string }[]>([]);
  const futureRef = useRef<{ phrases: Phrase[]; characters: Character[]; markers: Marker[]; fontSize?: number; fontFamily?: string; theme?: string }[]>([]);
  const isUndoRedoRef = useRef(false);
  const isInteractingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Push state to history before changes
  const pushHistory = (force = false) => {
    if (isUndoRedoRef.current) return;
    if (isInteractingRef.current && !force) return;
    const { phrases: p, characters: c, markers: m } = stateRef.current;

    // V90: Prevent redundant history pushes (Fixes "must press undo 2-3 times" issue)
    if (historyRef.current.length > 0) {
      const last = historyRef.current[historyRef.current.length - 1];
      const isSame = JSON.stringify(last.phrases) === JSON.stringify(p) &&
        JSON.stringify(last.markers) === JSON.stringify(m) &&
        JSON.stringify(last.characters) === JSON.stringify(c);
      if (isSame) return; // V2.X: Always prevent pushing perfectly identical states, even if forced!
    }

    historyRef.current.push({
      phrases: JSON.parse(JSON.stringify(p)),
      characters: JSON.parse(JSON.stringify(c)),
      markers: JSON.parse(JSON.stringify(m)),
      fontSize: stateRef.current.fontSize,
      fontFamily: stateRef.current.fontFamily,
      theme: stateRef.current.theme
    });
    if (historyRef.current.length > 50) historyRef.current.shift();
    futureRef.current = []; // Clear future on new action
  };

  // IPC Listeners (Cleaned up from init hook)
  useEffect(() => {
    let subProxy: any, subScene: any, subExport: any, subAudio: any;
    let subUpChecking: any, subUpAvail: any, subUpNotAvail: any, subUpDownload: any, subUpErr: any;

    subProxy = window.electron.ipcRenderer.on('proxy-progress', (percent: number) => setProxyProgress(percent));
    subScene = window.electron.ipcRenderer.on('scene-detection-progress', (percent: number) => setSceneDetectionProgress(percent));
    subExport = window.electron.ipcRenderer.on('export-status', (status: string) => setExportStatus(status as any));
    subAudio = window.electron.ipcRenderer.on('auto-rhythm-progress', (data: { pct: number, eta?: number, status?: string, engine?: string }) => {
      setExportProgress(data.pct);
    });

    subUpChecking = window.electron.ipcRenderer.on('update_checking', () => isManualUpdateCheckRef.current && setUpdateStatus('checking'));
    subUpAvail = window.electron.ipcRenderer.on('update_available', () => {
      setUpdateStatus('available');
      setUpdateAvailable(true);
      isManualUpdateCheckRef.current = false;
    });
    subUpNotAvail = window.electron.ipcRenderer.on('update_not_available', () => {
      if (isManualUpdateCheckRef.current) {
        setUpdateStatus('up-to-date');
        setTimeout(() => setUpdateStatus('idle'), 10000);
      } else setUpdateStatus('idle');
      isManualUpdateCheckRef.current = false;
    });
    subUpDownload = window.electron.ipcRenderer.on('update_downloaded', () => {
      setUpdateStatus('downloaded');
      setUpdateDownloaded(true);
      setUpdateAvailable(false);
      isManualUpdateCheckRef.current = false;
    });
    subUpErr = window.electron.ipcRenderer.on('update_error', (err: string) => {
      console.error('Update error detailed:', err);
      if (isManualUpdateCheckRef.current) {
        setUpdateStatus('error');
        setTimeout(() => setUpdateStatus('idle'), 80000);
      } else setUpdateStatus('idle');
      isManualUpdateCheckRef.current = false;
    });

    return () => {
      const e = window.electron.ipcRenderer;
      e.off('proxy-progress', subProxy);
      e.off('scene-detection-progress', subScene);
      e.off('export-status', subExport);
      e.off('auto-rhythm-progress', subAudio);
      e.off('update_checking', subUpChecking);
      e.off('update_available', subUpAvail);
      e.off('update_not_available', subUpNotAvail);
      e.off('update_downloaded', subUpDownload);
      e.off('update_error', subUpErr);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('vocap_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('vocap_font_size', fontSize.toString());
  }, [fontSize]);

  const handlePlayPause = () => {
    (videoPlayerRef.current as any)?.togglePlay?.();
    // Immediate sync on play/pause
    const newState = !stateRef.current.isPlaying;
    setTimeout(() => {
      AppBridge.syncVideoState({
        src: isProxyMode ? proxyPath : videoSrc,
        currentTime: currentTimeRef.current,
        isPlaying: newState
      });
    }, 10);
  };

  useEffect(() => {
    if (isSecondaryWindow) return;

    const interval = setInterval(() => {
      if (videoSrc) {
        AppBridge.syncVideoState({
          src: isProxyMode ? proxyPath : videoSrc,
          currentTime: currentTimeRef.current, // V120: Use Ref, not state (state is frozen at 0 during playback)
          isPlaying: stateRef.current.isPlaying
        });
      }
    }, 500);

    const subCmd = window.electron.ipcRenderer.on('video-command-main', (cmd: any) => {
      if (cmd.type === 'toggle-play') {
        handlePlayPause();
      }
    });

    return () => {
      clearInterval(interval);
      window.electron.ipcRenderer.off('video-command-main', subCmd);
    };
  }, [isSecondaryWindow, videoSrc, proxyPath, isProxyMode]);


  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current.pop();
    if (previous) {
      isUndoRedoRef.current = true;
      const { phrases: p, characters: c, markers: m, fontSize: fs, fontFamily: ff, theme: t } = stateRef.current;
      futureRef.current.push({
        phrases: JSON.parse(JSON.stringify(p)),
        characters: JSON.parse(JSON.stringify(c)),
        markers: JSON.parse(JSON.stringify(m)),
        fontSize: fs,
        fontFamily: ff,
        theme: t
      });
      setPhrases(previous.phrases);
      setCharacters(previous.characters);
      if (previous.markers) setMarkers(previous.markers);
      // @ts-ignore
      if (previous.fontSize) setFontSize(previous.fontSize);
      // @ts-ignore
      if (previous.fontFamily) setFontFamily(previous.fontFamily);
      // @ts-ignore
      if (previous.theme) setTheme(previous.theme);

      // Wait for state update before allowing new history pushes
      setTimeout(() => { isUndoRedoRef.current = false; }, 50);
    }
  };

  const handleRedo = () => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop();
    if (next) {
      isUndoRedoRef.current = true;
      const { phrases: p, characters: c, markers: m, fontSize: fs, fontFamily: ff, theme: t } = stateRef.current;
      historyRef.current.push({
        phrases: JSON.parse(JSON.stringify(p)),
        characters: JSON.parse(JSON.stringify(c)),
        markers: JSON.parse(JSON.stringify(m)),
        fontSize: fs,
        fontFamily: ff,
        theme: t
      });
      setPhrases(next.phrases);
      setCharacters(next.characters);
      if (next.markers) setMarkers(next.markers);
      // @ts-ignore
      if (next.fontSize) setFontSize(next.fontSize);
      // @ts-ignore
      if (next.fontFamily) setFontFamily(next.fontFamily);
      // @ts-ignore
      if (next.theme) setTheme(next.theme);

      setTimeout(() => { isUndoRedoRef.current = false; }, 50);
    }
  };

  // Wrapper for setState to ensure history is pushed
  const updatePhrases = (newPhrases: Phrase[] | ((prev: Phrase[]) => Phrase[]), isTyping = false) => {
    if (isTyping) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      // Wait 1s after typing stops before pushing to history
      typingTimeoutRef.current = setTimeout(() => pushHistory(true), 1000);
    } else if (!isInteractingRef.current) {
      // V2.X QoL: Only push history on discrete updates.
      // If the user is dragging (isInteractingRef=true), defer the push to onInteractionEnd.
      pushHistory();
    }
    setPhrases(newPhrases);
  };

  const updateCharacters = (newChars: Character[] | ((prev: Character[]) => Character[])) => {
    pushHistory();
    setCharacters(newChars);
  };

  const updateMarkers = (newMarkers: Marker[] | ((prev: Marker[]) => Marker[])) => {
    pushHistory();
    setMarkers(newMarkers);
  };

  const handleMarkerUpdate = (updatedMarker: Marker) => {
    updateMarkers(prev => prev.map(m => m.id === updatedMarker.id ? updatedMarker : m));
  };


  const handleExport = useCallback(async () => {
    if (!videoSrc) return;
    if (isExporting) return; // V21: Prevent double export

    isExportCancelledRef.current = false;
    setExportStartTime(performance.now());
    const maxTime = duration || 0;
    const originalPPS = pixelsPerSecond;

    try {
      const outputPath = await AppBridge.selectExportPath(videoSrc);
      if (!outputPath) return;

      // Start UI overlay only AFTER path is secured
      setIsExporting(true);
      setExportProgress(0);
      setExportETA("Initialisation...");

      // V14: Removed hardcoded setPixelsPerSecond(400).
      // Export now uses the exact speed you see in the editor.

      const targetWidth = exportRes === '1080p' ? 1920 : 1280;
      const targetHeight = exportRes === '1080p' ? 1080 : 720;
      const finalFps = exportFps || 30;

      // V20: Red Bar Absolute Synchronization
      // The user found that mathematical multipliers made the text scroll too fast. 
      // We use raw PPS. However, if redBarX is (1920 / 4) instead of (1280 / 4), the text 
      // has to travel further to hit the bar, making it look out of sync with audio.
      let uiWidth = 1280;
      const canvasEl = (rhythmicBandRef.current as any)?.canvasRef?.current;
      if (canvasEl && canvasEl.parentElement) {
        uiWidth = canvasEl.parentElement.clientWidth;
      }

      // Pass the raw 1920 resolution, fixed 300 height, and the fixed UI width.
      (rhythmicBandRef.current as any)?.setExportResolution?.(targetWidth, 300, uiWidth);

      setExportStatus('rendering');
      setExportProgress(0);

      // Start the completely native pipeline on the main process
      const startResult = await AppBridge.startExport({
        audioPath: selectedExportAudioPath || proxyPath || videoSrc || undefined,
        fps: finalFps,
        width: targetWidth,
        height: targetHeight,
        bandHeight: 300,
        encoder: exportEncoder === 'auto' ? undefined : exportEncoder,
        quality: exportQuality,
        outputPath,
        videoPath: videoSrc
      });

      if (!startResult) throw new Error("L'initialisation a échoué.");

      const totalFrames = Math.ceil(maxTime * finalFps);
      let batch: string[] = [];
      const captureStart = performance.now();
      setExportStatus('rendering');

      // V21/V22: Decoupling Export Speed
      // The user wants the export speed to be fixed at a stable, readable pace (200px/s)
      // regardless of how far they are zoomed in or out in the editor.
      const exportPps = 200;

      // V11/V14/V15: Refined frame capture loop (PPS forced and logged)
      console.log(`[Export] Starting render: duration=${maxTime}s, fps=${finalFps}, exportPps=${exportPps}`);
      for (let i = 0; i < totalFrames; i++) {
        if (isExportCancelledRef.current) { await AppBridge.cancelExport(); throw new Error("Exportation annulée."); }
        const t = i / finalFps;

        // V15/V21: Explicitly pass exportPps to bypass any stale closures and decouple from UI
        (rhythmicBandRef.current as any)?.forceRender(t, exportPps);

        const frame = rhythmicBandRef.current?.captureFrame();
        if (frame) batch.push(frame);

        if (batch.length >= 10 || i === totalFrames - 1) {
          await AppBridge.sendFrameBatch({ frames: batch });
          batch = [];
        }

        if (i % 60 === 0 || i === totalFrames - 1) {
          setExportProgress(Math.floor((i / totalFrames) * 95));
          const elapsed = (performance.now() - captureStart) / 1000;
          const remaining = (totalFrames - i) / (i / elapsed || 1);
          setExportETA(`${Math.floor(remaining / 60)}:${Math.floor(remaining % 60).toString().padStart(2, '0')}`);
          console.log(`[Export] Frame ${i}/${totalFrames} (t=${t.toFixed(3)}s) at ${exportPps}px/s`);
        }
      }

      setExportStatus('finishing');
      const finishResult = await AppBridge.finishExport({ outputPath });
      if (!finishResult.success) throw new Error(finishResult.error || "Échec de l'assemblage.");
      alert(`Exportation réussie !\nFichier : ${finishResult.path}`);

    } catch (error: any) {
      console.error("[Export] Error:", error);
      if (!isExportCancelledRef.current) alert(`Erreur d'exportation : ${error.message}`);
    } finally {
      setIsExporting(false);
      setIsExportModalOpen(false);
      setExportProgress(0);
      setPixelsPerSecond(originalPPS);
      window.dispatchEvent(new Event('resize'));
    }
  }, [videoSrc, exportFps, exportRes, exportQuality, exportEncoder, duration, proxyPath, pixelsPerSecond]);

  const handleSelectVideo = async () => {
    const path = await AppBridge.selectVideo();
    if (path) {
      setVideoSrc(ensureFileProtocol(path));
      setProxyPath(null);
      setIsProxyMode(false);
      const meta = await AppBridge.getVideoMetadata(path);
      if (meta?.fps) setVideoFps(meta.fps);
      if (meta?.duration) setDuration(meta.duration);
      setProjectSessionId(s => s + 1);
    }
  };

  const handleNewProject = () => {
    if (confirm("Créer un nouveau projet ?")) {
      setPhrases([]);
      setCharacters([
        { id: '1', name: 'Perso 1', color: '#ffffff' },
        { id: '2', name: 'Perso 2', color: '#ef4444' }
      ]);
      setSelectedCharacterId('1');
      setMarkers([]);
      setVideoSrc(null);
      setProxyPath(null);
      setIsProxyMode(false);
      setCurrentProjectPath(null);
      localStorage.removeItem('vocap_current_path');
      historyRef.current = [];
      futureRef.current = [];
      setProjectSessionId(s => s + 1);
    }
  };

  const handleSaveProject = async () => {
    const data = {
      phrases,
      characters,
      markers,
      audioTracks,
      videoSrc: videoSrc || '',
      version: appVersion
    };
    const path = await AppBridge.saveProject(data);
    if (path) {
      setCurrentProjectPath(path);
      localStorage.setItem('vocap_current_path', path);
      setShowSaveToast(true);
      setTimeout(() => setShowSaveToast(false), 3000);
    }
  };

  const handleSaveProjectSilent = async () => {
    if (!currentProjectPath) return handleSaveProject();
    const data = {
      phrases,
      characters,
      markers,
      audioTracks,
      videoSrc: videoSrc || '',
      version: appVersion
    };
    await AppBridge.saveProjectSilent(data, currentProjectPath);
    // Silent: no toast
  };

  const handleLoadProject = async () => {
    try {
      const result = await AppBridge.loadProject();
      if (result?.data) {
        const { data, path } = result;
        setPhrases(data.phrases || []);
        setCharacters(data.characters || [{ id: '1', name: 'Perso 1', color: '#ffffff' }, { id: '2', name: 'Perso 2', color: '#ef4444' }]);
        setMarkers(data.markers || []);
        if (data.audioTracks) setAudioTracks(data.audioTracks);
        if (data.videoSrc) {
          const v = ensureFileProtocol(data.videoSrc);
          setVideoSrc(v);
          AppBridge.getVideoMetadata(v).then(m => {
            if (m?.fps) setVideoFps(m.fps);
            if (m?.duration) setDuration(m.duration);
          });
        }
        if (path) {
          setCurrentProjectPath(path);
          localStorage.setItem('vocap_current_path', path);
        }
        setProjectSessionId(s => s + 1);
      }
    } catch (e) {
      console.error('Failed to load project:', e);
    }
  };

  const handleAIDetectScenes = async () => {
    if (!videoSrc) return;
    setIsDetectingScenes(true);
    try {
      const res = await AppBridge.detectScenes(videoSrc, 0.3, 0.5, true, false);
      if (res.success && res.markers) {
        const newMarkers = res.markers.map((t: number) => ({ id: crypto.randomUUID(), time: t, type: 'scene' as const }));
        updateMarkers(prev => {
          const merged = [...prev];
          newMarkers.forEach(nm => { if (!merged.find(m => Math.abs(m.time - nm.time) < 0.1)) merged.push(nm); });
          return merged.sort((a, b) => a.time - b.time);
        });
      }
    } catch (e) { console.error(e); } finally { setIsDetectingScenes(false); }
  };

  const handleCloseProject = () => {
    if (confirm("Fermer le projet ?")) {
      setPhrases([]);
      setCharacters([
        { id: '1', name: 'Perso 1', color: '#ffffff' },
        { id: '2', name: 'Perso 2', color: '#ef4444' }
      ]);
      setSelectedCharacterId('1');
      setVideoSrc(null);
      setProxyPath(null);
      setIsProxyMode(false);
      setMarkers([]);
      setCurrentProjectPath(null);
      historyRef.current = [];
      futureRef.current = [];
      setProjectSessionId(s => s + 1);
    }
  };

  const handleGenerateProxy = async () => {
    if (!videoSrc) return;
    setIsGeneratingProxy(true);
    try {
      const res = await AppBridge.generateProxy(videoSrc, duration);
      if (res.success && res.path) {
        setProxyPath(res.path);
        setIsProxyMode(true);
      }
    } catch (e) { console.error(e); } finally { setIsGeneratingProxy(false); }
  };

  const handleTimeUpdate = (time: number) => {
    currentTimeRef.current = time;
    window.dispatchEvent(new CustomEvent('time-update', { detail: { time, perf: performance.now() } }));
    if (!stateRef.current.isPlaying) setCurrentTime(time);
  };

  const handleFrameUpdate = (time: number, perf: number) => {
    currentTimeRef.current = time;
    window.dispatchEvent(new CustomEvent('time-update', { detail: { time, perf } }));
    if (!stateRef.current.isPlaying) setCurrentTime(time);
  };

  const handleSeek = (time: number) => {
    if (!isExporting) {
      videoPlayerRef.current?.seek(time);
      // Immediate sync on seek
      AppBridge.syncVideoState({
        src: isProxyMode ? proxyPath : videoSrc,
        currentTime: time,
        isPlaying: stateRef.current.isPlaying
      });
    }
  };

  const handleImportDetx = async () => {
    const res = await AppBridge.importDetx();
    if (res) {
      setCharacters(prev => {
        const next = [...prev];
        res.roles.forEach((r: any) => { if (!next.find(c => c.id === r.id)) next.push(r); });
        return next;
      });
      updatePhrases(prev => {
        const next = [...prev];
        res.phrases.forEach((p: any) => { if (!next.find(op => op.startTime === p.startTime)) next.push(p); });
        return next.sort((a, b) => a.startTime - b.startTime);
      });
    }
  };

  const handleAddMarker = (type: 'scene' | 'loop' = 'scene') => {
    const nm = { id: crypto.randomUUID(), time: currentTimeRef.current, type };
    updateMarkers(prev => [...prev, nm].sort((a, b) => a.time - b.time));
  };

  const handleRestartApp = () => {
    window.electron.restartApp();
  };

  const handleDownloadUpdate = () => {
    setUpdateStatus('downloading');
    window.electron.downloadUpdate();
  };

  const handleCheckUpdates = () => {
    isManualUpdateCheckRef.current = true;
    window.electron.ipcRenderer.invoke('check-updates');
    setUpdateStatus('checking');
  };

  const handleAddPhrase = (initialData?: Partial<Phrase>) => {
    const { characters: c, selectedCharacterId: sid, phrases: p } = stateRef.current;

    // Find the last used character in the existing phrases, fallback to selected, then to first character
    let lastUsedCharId = sid;
    if (p.length > 0) {
      lastUsedCharId = p[p.length - 1].characterId;
    }

    const charId = initialData?.characterId || lastUsedCharId;
    const character = c.find(char => char.id === charId) || c[0];
    const t = initialData?.startTime ?? currentTimeRef.current;

    let lastLine = 2;
    if (p.length > 0) {
      const prior = [...p].filter(ph => ph.startTime <= t).sort((a, b) => b.startTime - a.startTime);
      if (prior.length > 0) lastLine = prior[0].line || 2;
    }

    const np: Phrase = {
      id: crypto.randomUUID(),
      startTime: t,
      endTime: initialData?.endTime ?? (t + 2),
      text: initialData?.text || "",
      characterId: character.id,
      color: character?.color || '#ffffff',
      line: lastLine,
      ...initialData
    };

    setSelectedCharacterId(character.id);
    updatePhrases(prev => [...prev, np].sort((a, b) => a.startTime - b.startTime));
  };

  const handleAddFavorite = (text: string) => {
    const { phrases: p } = stateRef.current;
    const t = currentTimeRef.current;

    // Find phrase at current time
    const activePhrase = p.find(ph => t >= ph.startTime && t <= ph.endTime);

    if (activePhrase) {
      updatePhrases(prev => prev.map(ph =>
        ph.id === activePhrase.id
          ? { ...ph, text: ph.text ? `${ph.text} ${text}` : text }
          : ph
      ));
    } else {
      handleAddPhrase({ text, startTime: t, endTime: t + 2 });
    }
  };

  const handleSplitPhrase = (id: string) => {
    const phrase = phrases.find(p => p.id === id);
    if (!phrase || !phrase.text.includes('|')) return;
    const parts = phrase.text.split('|');
    const mid = phrase.startTime + (phrase.endTime - phrase.startTime) / 2;
    updatePhrases(prev => [
      ...prev.filter(p => p.id !== id),
      { ...phrase, text: parts[0].trim(), endTime: mid - 0.2 },
      { ...phrase, id: crypto.randomUUID(), text: parts.slice(1).join('|').trim(), startTime: mid + 0.2 }
    ].sort((a, b) => a.startTime - b.startTime));
  };

  const handleDeleteCharacter = (id: string) => {
    if (characters.length <= 1) return alert("Gardez au moins un perso.");
    setCharacters(prev => prev.filter(c => c.id !== id));
    setPhrases(prev => prev.map(p => p.characterId === id ? { ...p, characterId: characters[0].id } : p));
  };

  const handleDeleteMarker = (id: string) => updateMarkers(prev => prev.filter(m => m.id !== id));
  const handleUpdateCharacterName = (id: string, name: string) => setCharacters(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  const handleAddCharacter = () => {
    const nc = { id: crypto.randomUUID(), name: `Perso ${characters.length + 1}`, color: `#${Math.floor(Math.random() * 16777215).toString(16)}` };
    updateCharacters(prev => [...prev, nc]);
  };

  useEffect(() => {
    let anim: number;
    let last = 0;
    const poll = () => {
      if (isReversePlaying && videoPlayerRef.current) {
        const now = performance.now();
        if (now - last > 40) {
          (videoPlayerRef.current as any).stepFrame(-1);
          setCurrentTime((videoPlayerRef.current as any).getCurrentTime());
          last = now;
        }
      }
      anim = requestAnimationFrame(poll);
    };
    anim = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(anim);
  }, [isReversePlaying]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const { isReversePlaying, shortcuts: s, phrases: currentPhrases } = stateRef.current;

      if (isShortcutPressed(e, s.playPause)) { e.preventDefault(); (videoPlayerRef.current as any)?.togglePlay?.(); }
      else if (isShortcutPressed(e, s.reversePlay)) { e.preventDefault(); setIsReversePlaying(!isReversePlaying); }
      else if (isShortcutPressed(e, s.stepForward)) { e.preventDefault(); (videoPlayerRef.current as any)?.stepFrame?.(1); }
      else if (isShortcutPressed(e, s.stepBackward)) { e.preventDefault(); (videoPlayerRef.current as any)?.stepFrame?.(-1); }
      else if (isShortcutPressed(e, s.undo)) { e.preventDefault(); handleUndo(); }
      else if (isShortcutPressed(e, s.redo)) { e.preventDefault(); handleRedo(); }
      // Zoom Controls
      else if (isShortcutPressed(e, s.zoomIn)) { e.preventDefault(); setPixelsPerSecond(prev => Math.min(1000, prev + 50)); }
      else if (isShortcutPressed(e, s.zoomOut)) { e.preventDefault(); setPixelsPerSecond(prev => Math.max(100, prev - 50)); }
      // Audio Controls
      else if (isShortcutPressed(e, s.volUp)) { e.preventDefault(); const vp = videoPlayerRef.current as any; if (vp) vp.setVolume(vp.getVolume() + 0.1); }
      else if (isShortcutPressed(e, s.volDown)) { e.preventDefault(); const vp = videoPlayerRef.current as any; if (vp) vp.setVolume(vp.getVolume() - 0.1); }
      else if (isShortcutPressed(e, s.mute)) { e.preventDefault(); (videoPlayerRef.current as any)?.toggleMute?.(); }
      // Fullscreen
      else if (isShortcutPressed(e, s.fullscreen)) {
        e.preventDefault();
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.error(err));
        else document.exitFullscreen();
      }
      else if (isShortcutPressed(e, s.jumpToStart)) { e.preventDefault(); handleSeek(0); }
      else if (isShortcutPressed(e, s.jumpToEnd)) { e.preventDefault(); handleSeek(duration); }
      else if (isShortcutPressed(e, s.createPhrase)) { e.preventDefault(); handleAddPhrase(); }
      else if (isShortcutPressed(e, s.deleteItem)) {
        e.preventDefault();
        const t = currentTimeRef.current;
        // Delete active phrase or marker at current time
        const phraseToDelete = currentPhrases.find(p => t >= p.startTime && t <= p.endTime);
        if (phraseToDelete) {
          updatePhrases(prev => prev.filter(p => p.id !== phraseToDelete.id));
        } else {
          const markerToDelete = markers.find(m => Math.abs(m.time - t) < 0.1);
          if (markerToDelete) handleDeleteMarker(markerToDelete.id);
        }
      }
      else if (isShortcutPressed(e, s.prevPhrase)) {
        e.preventDefault();
        const t = currentTimeRef.current;
        const prev = [...currentPhrases].reverse().find(p => p.startTime < t - 0.1);
        if (prev) handleSeek(prev.startTime);
      }
      else if (isShortcutPressed(e, s.nextPhrase)) {
        e.preventDefault();
        const t = currentTimeRef.current;
        const next = currentPhrases.find(p => p.startTime > t + 0.1);
        if (next) handleSeek(next.startTime);
      }
      else if (isShortcutPressed(e, s.prevMarker)) {
        e.preventDefault();
        const t = currentTimeRef.current;
        const prev = [...markers].reverse().find(m => m.time < t - 0.1);
        if (prev) handleSeek(prev.time);
      }
      else if (isShortcutPressed(e, s.nextMarker)) {
        e.preventDefault();
        const t = currentTimeRef.current;
        const next = markers.find(m => m.time > t + 0.1);
        if (next) handleSeek(next.time);
      }
      else if (isShortcutPressed(e, s.addSceneMarker)) { e.preventDefault(); updateMarkers(prev => [...prev, { id: crypto.randomUUID(), time: currentTimeRef.current, type: 'scene' as const }].sort((a, b) => a.time - b.time)); }
      else if (isShortcutPressed(e, s.addLoopMarker)) { e.preventDefault(); updateMarkers(prev => [...prev, { id: crypto.randomUUID(), time: currentTimeRef.current, type: 'loop' as const }].sort((a, b) => a.time - b.time)); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSaveProjectSilent(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (isSecondaryWindow) {
    return <SecondaryVideo />;
  }

  return (
    <div className={`h-screen w-full flex flex-col font-sans transition-opacity duration-1000 ${isDark ? 'bg-[#000000] text-zinc-300' : 'bg-[#fdfaf0] text-zinc-900'}`}>
      <TitleBar />
      <header className="h-14 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-[#05070a] z-[100] relative">
        <div className="flex items-center h-full">
          {/* Action Menu (Integrated) - Stitch Style */}
          <div className="flex items-center gap-1.5 pr-4 h-full relative z-[150]">
            <div className="relative">
              <button
                onClick={() => setIsActionMenuOpen(!isActionMenuOpen)}
                className={`flex items-center gap-3 h-10 px-5 rounded-[12px] transition-all border border-white/10 ${isActionMenuOpen ? 'bg-white/10 border-[#e11d48]/40 shadow-[0_0_15px_rgba(225,29,72,0.2)]' : 'bg-black/40 hover:bg-white/5'}`}
              >
                <div className="flex flex-col items-start -space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e11d48]">Vocap</span>
                </div>
                <ChevronDown size={14} className={`text-slate-500 transition-transform ${isActionMenuOpen ? 'rotate-180 text-white' : ''}`} />
              </button>

              {isActionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[140] block" onClick={() => setIsActionMenuOpen(false)} />
                  <div className="absolute top-12 left-0 w-64 bg-[#0e0e10]/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] z-[200] overflow-hidden py-2 animate-in zoom-in-95 duration-200">
                    <div className="px-4 py-2 border-b border-white/5 mb-2">
                      <span className="text-[8px] font-black uppercase tracking-widest text-[#e11d48]/60">Menu d'Actions</span>
                    </div>

                    <button onClick={() => { setIsActionMenuOpen(false); handleNewProject(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <PlusSquare size={16} className="text-[#e11d48] group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Nouveau Projet</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleLoadProject(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <FolderOpen size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Charger un Projet</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleSaveProjectSilent(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <Save size={16} className="text-[#e11d48] group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Enregistrer</span>
                      </div>
                      <span className="text-[8px] font-black text-slate-600 group-hover:text-[#e11d48] transition-colors tracking-tighter">CTRL+S</span>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleSaveProject(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <Save size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Enregistrer Sous...</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleImportDetx(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <Download size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Importer Cappella (.detx)</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleCloseProject(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <LogOut size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Fermer le Projet</span>
                      </div>
                    </button>

                    <div className="h-px bg-white/5 my-2 mx-4" />

                    <button onClick={() => { setIsActionMenuOpen(false); handleSelectVideo(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <FileVideo size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Changer la Vidéo</span>
                      </div>
                    </button>
                    <button
                      onClick={() => { setIsActionMenuOpen(false); if (!proxyPath) handleGenerateProxy(); else setIsProxyMode(!isProxyMode); }}
                      disabled={isGeneratingProxy || !videoSrc}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left disabled:opacity-30"
                    >
                      <div className="flex items-center gap-3">
                        <Zap size={16} className={`text-slate-400 group-hover:text-[#e11d48] ${isProxyMode ? 'text-yellow-400' : ''}`} />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">{isGeneratingProxy ? `Optimisation (${proxyProgress}%)` : (proxyPath ? (isProxyMode ? "Désactiver Proxy" : "Activer Proxy") : "Générer Proxy")}</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); setIsExportModalOpen(true); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#e11d48]/10 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <RefreshCw size={16} className="text-[#e11d48]" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Exporter la vidéo</span>
                      </div>
                    </button>

                    <button onClick={() => { setIsActionMenuOpen(false); AppBridge.openVideoWindow(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <Monitor size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Sortie Vidéo Secondaire</span>
                      </div>
                    </button>

                    <div className="h-px bg-white/5 my-2 mx-4" />

                    <button onClick={() => { setIsActionMenuOpen(false); setIsShortcutsModalOpen(true); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <Layout size={16} className="text-slate-400 group-hover:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Raccourcis Clavier</span>
                      </div>
                    </button>
                    <button onClick={() => { setIsActionMenuOpen(false); handleCheckUpdates(); }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group text-left">
                      <div className="flex items-center gap-3">
                        <RotateCcw size={16} className={`text-slate-400 group-hover:text-white ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 group-hover:text-white">Mises à jour</span>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="h-8 w-px bg-white/5 mx-2" />
          <TimecodeDisplay fps={videoFps} />
        </div>

        {/* Restore Header Shortcuts/Icons */}
        <div className="flex items-center gap-1.5 no-drag">
          {/* Reverted header buttons to avoid duplicates, actions remain in VOCAP menu */}
        </div>

        {/* Global Notifications */}
        <div className="flex items-center gap-2">
          {appVersion && (
            <div className="px-2 py-1 rounded bg-white/5 border border-white/10 flex items-center gap-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">v{appVersion}</span>
            </div>
          )}
          {updateAvailable && (
            <div className="p-2 rounded-lg border border-blue-500/20 bg-[#0e0e10] flex items-center gap-3 shadow-2xl animate-in slide-in-from-right-4">
              <div className="size-1 rounded-full bg-blue-500 animate-pulse"></div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#60a5fa]">MAJ Disponible</span>
              <button
                onClick={handleDownloadUpdate}
                disabled={updateStatus === 'downloading'}
                className="text-[9px] font-black underline uppercase text-zinc-400 hover:text-white ml-1 disabled:opacity-50"
              >
                {updateStatus === 'downloading' ? 'Téléchargement...' : 'Télécharger'}
              </button>
            </div>
          )}
          {updateDownloaded && (
            <div className="p-2 rounded-lg border border-green-500/20 bg-[#0e0e10] flex items-center gap-3 shadow-2xl animate-in slide-in-from-right-4">
              <div className="size-1 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#4ade80]">Téléchargé</span>
              <button onClick={handleRestartApp} className="text-[9px] font-black underline uppercase text-zinc-400 hover:text-white ml-1">Installer</button>
            </div>
          )}
          {showSaveToast && (
            <div className="p-2 rounded-lg border border-green-500/20 bg-[#0e0e10] flex items-center gap-3 shadow-2xl animate-in slide-in-from-right-4">
              <div className="size-1 rounded-full bg-green-500"></div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#4ade80]">Enregistré</span>
            </div>
          )}
        </div>
      </header>


      <div className="flex flex-1 flex-row overflow-hidden relative">
        {/* Video Player Section */}
        <main className={`flex-1 flex flex-col relative overflow-hidden min-w-0 transition-colors ${isDark ? 'bg-zinc-950' : 'bg-[#fdfaf0]'}`}>
          <div className={`flex-1 min-h-0 relative flex flex-col ${isDark ? 'bg-[#05070a]' : 'bg-transparent'}`}>
            <VideoPlayer
              ref={videoPlayerRef}
              src={isProxyMode ? proxyPath : videoSrc}
              onTimeUpdate={handleTimeUpdate}
              onFrameUpdate={handleFrameUpdate}
              onDurationChange={(d) => setDuration(d)}
              onPlayChange={(playing) => {
                setIsPlaying(playing);
                if (!playing && videoPlayerRef.current) {
                  const exactTime = (videoPlayerRef.current as any).getCurrentTime();
                  setCurrentTime(exactTime);
                }
              }}
              onSelect={handleSelectVideo}
              fps={videoFps}
              isExporting={isExporting}
            />

            {/* Background Audio Tracks (Recordings / Imports) */}
            {audioTracks.map((track) => (
              <AudioTrackPlayer
                key={track.id}
                path={track.path}
                isPlaying={isPlaying}
                currentTime={currentTime}
                volume={track.volume}
                isMuted={track.isMuted}
                startTime={track.startTime}
              />
            ))}
          </div>

          {/* Integrated Band Toolbar: High Precision Controls - Stitch Style */}
          <div className="flex items-center justify-between px-8 py-3 bg-[#05070a] border-y border-white/5 shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-20">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-black/40 rounded-[12px] border border-white/5 p-1 gap-1">
                  <button
                    onClick={() => handleAddMarker('scene')}
                    className="flex items-center justify-center gap-2 h-8 px-4 rounded-[8px] text-slate-400 hover:text-white hover:bg-white/5 transition-all text-[10px] font-bold uppercase tracking-widest"
                    title="Marqueur de Plan"
                  >
                    <MapPin size={14} className="text-[#e11d48]" />
                    PLAN
                  </button>
                  <div className="w-px h-4 bg-white/10"></div>
                  <button
                    onClick={() => handleAddMarker('loop')}
                    className="flex items-center justify-center gap-2 h-8 px-4 rounded-[8px] text-slate-400 hover:text-white hover:bg-white/5 transition-all text-[10px] font-bold uppercase tracking-widest"
                    title="Marqueur de Boucle"
                  >
                    <RefreshCw size={14} className="text-slate-500" />
                    BOUCLE
                  </button>
                  <div className="w-px h-4 bg-white/10 mx-1"></div>
                  <button
                    onClick={() => handleAddPhrase()}
                    className="flex items-center justify-center gap-2 h-8 px-4 rounded-[8px] text-zinc-100 bg-[#e11d48]/20 border border-[#e11d48]/30 hover:bg-[#e11d48] hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest"
                    title="Ajouter une Phrase au curseur"
                  >
                    <MessageSquare size={14} />
                    PHRASE
                  </button>
                </div>
              </div>

              <div className="h-6 w-px bg-zinc-800 mx-2"></div>

              <div className="flex items-center gap-4">
                {/* Taille Texte Option Removed */}

                <div className="flex flex-col gap-1">
                  <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Police</span>
                  <div className="relative group max-w-[160px]">
                    <Type size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-hover:text-[#e11d48] transition-colors pointer-events-none" />
                    <select
                      value={fontFamily}
                      onChange={(e) => {
                        const f = e.target.value;
                        pushHistory();
                        setFontFamily(f);
                        localStorage.setItem('vocap_font', f);
                      }}
                      className="bg-black/40 border border-[#1f1f23] text-[10px] font-bold text-zinc-300 outline-none hover:border-[#e11d48] hover:text-white transition-all cursor-pointer appearance-none uppercase pl-9 pr-8 h-8 rounded-lg w-full truncate"
                    >
                      {[...new Set(['Outfit', 'Inter', 'Roboto', 'Montserrat', 'Lato', 'Open Sans', 'Poppins', 'Playfair Display', ...availableFonts])].map(font => (
                        <option key={font} value={font} className="bg-[#0e0e10] p-2">{font}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 group-hover:text-white transition-colors pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end gap-1">
                <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Zoom ({pixelsPerSecond}px/s)</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setPixelsPerSecond(prev => Math.max(100, prev - 50))} className="text-zinc-500 hover:text-white transition-colors"><ZoomOut size={16} /></button>
                  <input
                    type="range"
                    min="100" max="1000" step="50"
                    value={pixelsPerSecond}
                    onChange={(e) => setPixelsPerSecond(parseInt(e.target.value))}
                    onDoubleClick={() => setPixelsPerSecond(400)}
                    className="w-32 h-1 bg-zinc-800 appearance-none rounded-full accent-[#e11d48] cursor-pointer"
                    title="Double-clic pour réinitialiser (400px/s)"
                  />
                  <button onClick={() => setPixelsPerSecond(prev => Math.min(1000, prev + 50))} className="text-zinc-500 hover:text-white transition-colors"><ZoomIn size={16} /></button>
                </div>
              </div>

              <div className="h-6 w-px bg-zinc-800 mx-1"></div>

              <div className="flex items-center gap-2 p-1 rounded-xl bg-black/40 border border-[#1f1f23]">
                <div className="flex gap-1">
                  {['#050505', '#18181b', '#3f3f46', '#fdfaf0'].map(color => (
                    <button
                      key={color}
                      onClick={() => { pushHistory(); setBandBackgroundColor(color); }}
                      className={`size-5 rounded-full border-2 transition-all hover:scale-110 ${bandBackgroundColor === color ? 'border-[#e11d48] shadow-[0_0_10px_#e11d4840]' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      title={color === '#fdfaf0' ? 'Blanc Neutre' : 'Noir/Gris Neutre'}
                    />
                  ))}
                </div>
                <div className="h-4 w-px bg-[#1f1f23] mx-0.5"></div>
                <div className="relative size-6 flex items-center justify-center group">
                  <input
                    type="color"
                    value={bandBackgroundColor.startsWith('#') ? bandBackgroundColor : '#000000'}
                    onChange={(e) => { pushHistory(); setBandBackgroundColor(e.target.value); }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    title="Choisir une couleur personnalisée"
                  />
                  <div
                    className="size-5 rounded-full border-2 border-dashed border-zinc-500 group-hover:border-white transition-colors flex items-center justify-center bg-gradient-to-tr from-[#e11d48] to-blue-500 overflow-hidden"
                  >
                    {!['#050505', '#18181b', '#3f3f46', '#fdfaf0'].includes(bandBackgroundColor) && (
                      <div className="absolute inset-0 border-2 border-[#e11d48] rounded-full shadow-[0_0_10px_#e11d4840]"></div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative flex flex-col min-h-0 shrink-0">
            {isDetectingScenes && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-zinc-950/90 border border-zinc-800 text-white px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex flex-col items-center gap-2 min-w-[280px] animate-in slide-in-from-top-4 duration-300">
                <div className="flex items-center gap-3 w-full">
                  <RotateCcw size={16} className="animate-spin text-red-500" />
                  <span className="text-xs font-bold uppercase tracking-widest">Analyse des plans en cours...</span>
                </div>
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${sceneDetectionProgress}%` }}></div>
                </div>
              </div>
            )}

            <RhythmicBand
              ref={rhythmicBandRef}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              phrases={memoizedPhrases}
              markers={markers}
              onPhraseUpdate={(updated: any) => {
                updatePhrases(prev => prev.map(p => p.id === updated.id ? updated : p));
              }}
              onMarkerUpdate={handleMarkerUpdate}
              onSeek={handleSeek}
              onDeleteMarker={handleDeleteMarker}
              onDeletePhrase={(id) => updatePhrases(prev => prev.filter(p => p.id !== id))}
              onSplitPhrase={handleSplitPhrase}
              pixelsPerSecond={pixelsPerSecond}
              shortcuts={shortcuts}
              theme={theme}
              fontSize={fontSize}
              fontFamily={fontFamily}
              backgroundColor={bandBackgroundColor}
              fps={isExporting ? exportFps : videoFps}
              onInteractionStart={() => {
                isInteractingRef.current = true;
                pushHistory(true);
              }}
              onInteractionEnd={() => {
                isInteractingRef.current = false;
              }}
            />

            <div className="px-6 py-2 bg-[#0e0e10] border-t border-[#1f1f23]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Mini-Map de Navigation</span>
                <span className="text-[8px] font-mono text-zinc-700">{Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(1).padStart(4, '0')} / {Math.floor(duration / 60)}:{(duration % 60).toFixed(0).padStart(2, '0')}</span>
              </div>
              <MiniMap
                phrases={memoizedPhrases as any}
                duration={duration}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            </div>
          </div>
        </main>



        {/* Sidebar Container */}
        {/* Unified Sidebar: Ultra Dark Tabbed Component */}
        <aside className="w-96 flex flex-col bg-[#0e0e10] border-l border-[#1f1f23] overflow-hidden">
          {/* Tabs Navigation */}
          <div className="flex border-b border-[#1f1f23] bg-[#05070a]">
            {[
              { id: 'dialogue', icon: FileText, label: 'Dialogue' },
              { id: 'characters', icon: Users, label: 'Persos' },
              { id: 'audio', icon: Music, label: 'Audio' },
              { id: 'favorites', icon: Zap, label: 'Favoris' },
              { id: 'project', icon: Layout, label: 'Projet' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex flex-col items-center justify-center py-3 gap-1.5 transition-all relative group ${activeTab === tab.id ? 'text-[#e11d48]' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <tab.icon size={16} className={activeTab === tab.id ? 'animate-pulse' : ''} />
                <span className="text-[8px] font-black uppercase tracking-widest">{tab.label}</span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#e11d48] shadow-[0_0_10px_#e11d48]" />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="animate-in fade-in slide-in-from-right-2 duration-300">

              {activeTab === 'characters' && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2"><Users size={14} /> PERSONNAGES</h3>
                    <button onClick={handleAddCharacter} className="text-zinc-500 hover:text-white transition-colors"><Plus size={14} /></button>
                  </div>
                  <div className="space-y-2">
                    {characters.map(char => (
                      <div key={char.id} className="flex items-center justify-between p-2 rounded bg-[#050505]/40 border border-[#1f1f23] group hover:border-[#e11d48]/30 transition-all">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="relative group/color size-4 flex items-center justify-center shrink-0">
                            <input
                              type="color"
                              value={char.color}
                              onChange={(e) => {
                                const newColor = e.target.value;
                                setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, color: newColor } : c));
                                setPhrases(prev => prev.map(p => p.characterId === char.id ? { ...p, color: newColor } : p));
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full"
                              title="Changer la couleur du personnage"
                            />
                            <div
                              className="size-3 rounded-full shadow-lg transition-transform group-hover/color:scale-125"
                              style={{ backgroundColor: char.color, boxShadow: `0 0 10px ${char.color}40` }}
                            />
                          </div>
                          <input
                            type="text"
                            value={char.name}
                            onChange={(e) => handleUpdateCharacterName(char.id, e.target.value)}
                            className="bg-transparent border-none outline-none text-xs font-bold text-zinc-300 uppercase tracking-wide w-full focus:text-white transition-colors"
                          />
                        </div>
                        <button onClick={() => handleDeleteCharacter(char.id)} className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeTab === 'project' && (
                <div className="space-y-6">
                  <section className="space-y-4">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2"><Layout size={14} /> OUTILS ET VALIDATION</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setIsConsistencyModalOpen(true)}
                        className="flex flex-col items-center justify-center p-4 rounded-xl bg-orange-500/5 border border-orange-500/20 text-orange-500 hover:bg-orange-500/10 hover:border-orange-500/40 transition-all gap-2 group shadow-lg shadow-orange-950/20"
                      >
                        <div className="size-8 rounded-full bg-orange-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <AlertTriangle size={18} />
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-widest">Valider</span>
                      </button>

                      <button
                        onClick={() => {
                          const name = prompt("Nom de la version (Checkpoint) :", `Sauvegarde ${new Date().toLocaleTimeString()}`);
                          if (name) createCheckpoint(name);
                        }}
                        className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-blue-500 hover:bg-blue-500/10 hover:border-blue-500/40 transition-all gap-2 group shadow-lg shadow-blue-950/20"
                      >
                        <div className="size-8 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:rotate-180 transition-transform duration-500">
                          <RefreshCw size={18} />
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-widest">Snapshot</span>
                      </button>
                    </div>
                  </section>

                  <section className="pt-4 border-t border-[#1f1f23]">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">IMPORTATION EXTRINSÈQUE</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={handleImportSubtitle}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-zinc-900 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10 transition-all shadow-lg active:scale-95"
                      >
                        <Download size={14} className="text-blue-500" />
                        Importer SRT / XML
                      </button>
                    </div>
                  </section>

                  <section className="pt-4 border-t border-[#1f1f23]">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2"><Scissors size={14} /> DÉTECTION DE PLANS</h3>
                    <button
                      onClick={handleAIDetectScenes}
                      disabled={isDetectingScenes || !videoSrc}
                      className="w-full py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] border border-[#1f1f23] text-zinc-300 hover:bg-[#1f1f23] transition-all active:scale-95"
                    >
                      {isDetectingScenes ? 'Analyse...' : 'Détecter les Cut'}
                    </button>
                  </section>

                  {projectVersions.length > 0 && (
                    <section className="pt-4 border-t border-[#1f1f23]">
                      <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">HISTORIQUE VERSIONS</h3>
                      <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                        {projectVersions.map(v => (
                          <div key={v.id} className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-900 group">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[10px] font-bold text-zinc-300 truncate">{v.name}</span>
                              <span className="text-[8px] text-zinc-600 uppercase">{new Date(v.time).toLocaleString()}</span>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => restoreVersion(v)} className="p-1 text-blue-500 hover:bg-blue-500/10 rounded transition-all" title="Restaurer"><RotateCcw size={12} /></button>
                              <button onClick={() => setProjectVersions(prev => prev.filter(x => x.id !== v.id))} className="p-1 text-zinc-700 hover:text-red-500 transition-all" title="Supprimer"><X size={12} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {activeTab === 'favorites' && (
                <section className="space-y-6">
                  <div>
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2"><Zap size={14} className="text-yellow-500" /> FAVORIS DE PHRASÉ</h3>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {favorites.map((fav, i) => (
                        <div key={i} className="group relative">
                          <button
                            onClick={() => handleAddFavorite(fav)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-white/5 text-[10px] font-black text-zinc-400 hover:text-white hover:border-[#e11d48]/50 hover:bg-[#e11d48]/10 transition-all outline-none"
                          >
                            {fav}
                          </button>
                          <button
                            onClick={() => setFavorites(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1 -right-1 size-4 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all shadow-lg"
                          >
                            <X size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/5 space-y-3">
                    <h4 className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Nouveau Favori</h4>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ex: (RIRE), [EXT], ..."
                        value={newFavoriteText}
                        onChange={(e) => setNewFavoriteText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newFavoriteText.trim()) {
                            setFavorites(prev => [...prev, newFavoriteText.trim()]);
                            setNewFavoriteText('');
                          }
                        }}
                        className="flex-1 bg-black/40 border border-[#1f1f23] rounded-lg px-3 py-2 text-[10px] font-bold text-zinc-300 outline-none focus:border-[#e11d48]/50 focus:text-white transition-all"
                      />
                      <button
                        onClick={() => {
                          if (newFavoriteText.trim()) {
                            setFavorites(prev => [...prev, newFavoriteText.trim()]);
                            setNewFavoriteText('');
                          }
                        }}
                        className="p-2 rounded-lg bg-[#e11d48] text-white hover:bg-[#be123c] transition-all"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <p className="text-[8px] text-zinc-700 italic">Appuyez sur Entrée pour ajouter rapidement.</p>
                  </div>
                </section>
              )}

              {activeTab === 'audio' && (
                <section className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2"><Music size={14} className="text-blue-500" /> SOURCES AUDIO</h3>
                    <button
                      onClick={handleAddAudioTrack}
                      className="size-6 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {/* Voice Recorder removed by user request */}

                  <div className="space-y-3">
                    {/* Native Video Track */}
                    {videoSrc && (
                      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl space-y-3 group shadow-lg shadow-red-950/10">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileVideo size={12} className="text-red-500 shrink-0" />
                            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-wider truncate">Piste Vidéo Originale</span>
                          </div>
                          <span className="text-[8px] font-black text-red-500/50 uppercase tracking-widest bg-red-500/10 px-1.5 py-0.5 rounded">Native</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setNativeAudioMuted(!nativeAudioMuted)}
                            className={`size-6 rounded flex items-center justify-center transition-all ${nativeAudioMuted ? 'bg-red-500/20 text-red-500' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                          >
                            {nativeAudioMuted ? <VolumeX size={12} /> : <Volume1 size={12} />}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={nativeAudioMuted ? 0 : nativeAudioVolume}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setNativeAudioVolume(v);
                              if (v > 0) setNativeAudioMuted(false);
                            }}
                            className="flex-1 h-1 bg-zinc-800 appearance-none rounded-full accent-red-500 cursor-pointer"
                          />
                        </div>
                      </div>
                    )}

                    {audioTracks.length === 0 && !videoSrc && (
                      <div className="p-8 border border-dashed border-zinc-800 rounded-xl text-center">
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest leading-relaxed">
                          Aucune piste audio<br />détectée.
                        </p>
                      </div>
                    )}
                    {audioTracks.map(track => (
                      <div key={track.id} className="p-3 bg-zinc-950/50 border border-zinc-900 rounded-xl space-y-3 group">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Music size={12} className="text-zinc-500 shrink-0" />
                            <span className="text-[10px] font-bold text-zinc-300 truncate">{track.name}</span>
                          </div>
                          <button
                            onClick={() => setAudioTracks(prev => prev.filter(t => t.id !== track.id))}
                            className="size-5 rounded flex items-center justify-center text-zinc-700 hover:text-red-500 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <X size={12} />
                          </button>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setAudioTracks(prev => prev.map(t => t.id === track.id ? { ...t, isMuted: !t.isMuted } : t))}
                            className={`size-6 rounded flex items-center justify-center transition-all ${track.isMuted ? 'bg-red-500/20 text-red-500' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                          >
                            {track.isMuted ? <VolumeX size={12} /> : <Volume1 size={12} />}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={track.isMuted ? 0 : track.volume}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setAudioTracks(prev => prev.map(t => t.id === track.id ? { ...t, volume: v, isMuted: v === 0 } : t));
                            }}
                            className="flex-1 h-1 bg-zinc-800 appearance-none rounded-full accent-blue-500 cursor-pointer"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-white/5">
                    <p className="text-[8px] text-zinc-600 italic leading-relaxed uppercase tracking-tighter">
                      Les pistes audio sont synchronisées<br />avec la tête de lecture vidéo par défaut.
                    </p>
                  </div>
                </section>
              )}

              {activeTab === 'dialogue' && (
                <section className="h-full flex flex-col min-h-0 min-w-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2"><FileText size={14} /> SÉQUENCES</h3>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleAddPhrase()}
                        className="size-6 rounded-lg bg-[#e11d48]/10 border border-[#e11d48]/20 flex items-center justify-center text-[#e11d48] hover:bg-[#e11d48] hover:text-white transition-all"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="text-[9px] font-black text-zinc-700">{phrases.length}</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <DialogueEditor
                      phrases={phrases as any}
                      characters={characters}
                      selectedCharacterId={selectedCharacterId}
                      onSelectCharacter={setSelectedCharacterId}
                      onAdd={handleAddPhrase}
                      onRemove={(id) => updatePhrases(prev => prev.filter(p => p.id !== id))}
                      onUpdate={(updated, isTyping) => updatePhrases(prev => prev.map(p => p.id === updated.id ? updated : p), isTyping)}
                      currentTime={currentTime}
                      onSeek={handleSeek}
                      theme={theme}
                    />
                  </div>
                </section>
              )}
            </div>
          </div>
        </aside>
      </div >


      {/* Audio Players Instance */}
      {audioTracks.map(track => (
        <AudioTrackPlayer
          key={track.id}
          path={track.path}
          isPlaying={isPlaying}
          currentTime={currentTime}
          volume={track.volume}
          isMuted={track.isMuted}
        />
      ))}

      <footer className="h-6 border-t border-[#1f1f23] bg-[#0e0e10] flex items-center px-4 justify-between text-[10px] font-mono shrink-0 text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><FileVideo size={10} /> {videoSrc ? videoSrc.split(/[\\/]/).pop() : 'AUCUN FICHIER'}</span>
          <span className="text-zinc-800">|</span>
          <span className="flex items-center gap-1.5"><MessageSquare size={10} /> {phrases.length} SÉQUENCES</span>
          <span className="text-zinc-800">|</span>
          <span className="flex items-center gap-1.5"><Clock size={10} /> {duration ? Math.floor(duration / 60) + ':' + (duration % 60).toFixed(0).padStart(2, '0') : '00:00:00'}</span>
        </div>
        <div className="flex items-center gap-4 relative">
          <div
            className={`flex items-center gap-2 px-2 py-0.5 rounded cursor-pointer transition-all ${updateStatus === 'checking' ? 'text-zinc-400' :
              updateStatus === 'available' ? 'bg-rose-500/20 text-rose-500' :
                updateStatus === 'downloaded' ? 'bg-green-600/20 text-green-400 animate-pulse' :
                  updateStatus === 'up-to-date' ? 'text-zinc-600' :
                    'opacity-0'
              }`}
            onClick={() => setShowUpdateDetails(!showUpdateDetails)}
          >
            <div className={`w-1 h-1 rounded-full ${updateStatus === 'checking' ? 'bg-zinc-500 animate-pulse' :
              updateStatus === 'available' ? 'bg-rose-500' :
                updateStatus === 'downloaded' ? 'bg-green-500' :
                  'bg-zinc-600'
              }`} />
            <span className="text-[8px] uppercase tracking-tighter">
              {updateStatus === 'checking' ? 'Vérification...' :
                updateStatus === 'available' ? 'Mise à jour disponible' :
                  updateStatus === 'downloaded' ? 'Prêt à installer' :
                    updateStatus === 'up-to-date' ? 'Application à jour' :
                      updateStatus === 'error' ? 'Erreur serveur' :
                        'Prêt'}
            </span>
          </div>

          {showUpdateDetails && (
            <div className={`absolute bottom-full mb-2 right-0 w-64 p-4 rounded-xl border shadow-2xl z-[100] text-[10px] ${isDark ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-700'}`}>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2 mb-2">
                <span className="font-bold text-[9px] uppercase tracking-widest text-zinc-500">Mise à jour VOCAP</span>
                <button onClick={(e) => { e.stopPropagation(); setShowUpdateDetails(false); }} title="Fermer">
                  <X size={10} />
                </button>
              </div>
              <p className="text-zinc-500 text-[9px] mb-3 leading-relaxed">
                {updateStatus === 'checking' ? "Connexion au serveur de mise à jour..." :
                  updateStatus === 'available' ? "Une nouvelle version a été trouvée. Téléchargement en cours..." :
                    updateStatus === 'downloaded' ? "Téléchargement terminé. Redémarrez l'application pour installer." :
                      updateStatus === 'up-to-date' ? "Votre version de VOCAP est la plus récente." :
                        "Impossible de contacter le serveur de mise à jour."}
              </p>
              {updateStatus === 'downloaded' && (
                <button
                  onClick={handleRestartApp}
                  className="w-full py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold uppercase text-[9px] shadow-lg shadow-green-900/40"
                >
                  Installer & Redémarrer
                </button>
              )}
              {(updateStatus === 'up-to-date' || updateStatus === 'error') && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCheckUpdates(); }}
                  className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded font-bold uppercase text-[9px]"
                >
                  Vérifier à nouveau
                </button>
              )}
              <div className="mt-3 pt-2 border-t border-zinc-800 text-[8px] text-zinc-600 flex justify-between uppercase font-mono">
                <span>Vers: v{appVersion}</span>
                <span>Type: Generic</span>
              </div>
            </div>
          )}
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
      </footer>

      {/* Main modals section continues below */}

      {
        isExporting && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[200] flex items-center justify-center animate-in fade-in duration-500">
            <div className="relative w-[450px] p-10 rounded-[32px] bg-zinc-900/50 border border-white/10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] overflow-hidden group">
              {/* Animated background gradient */}
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-red-600/10 rounded-full blur-[80px] group-hover:bg-red-600/20 transition-all duration-1000"></div>
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/10 rounded-full blur-[80px] group-hover:bg-blue-600/20 transition-all duration-1000"></div>

              <div className="relative flex flex-col items-center gap-8">
                {/* Premium Icon Container */}
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 border border-white/5 flex items-center justify-center shadow-inner relative">
                  <div className="absolute inset-0 rounded-2xl bg-red-600/5 blur-xl animate-pulse"></div>
                  <Download className="text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]" size={32} />
                </div>

                <div className="text-center space-y-3">
                  <h2 className="text-2xl font-black uppercase tracking-[0.2em] text-white">Exportation</h2>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></div>
                    <p className="text-zinc-400 text-[10px] uppercase font-black tracking-widest opacity-60">
                      {exportStatus === 'separating' ? 'Séparation Audio IA' :
                        exportStatus === 'baking' ? 'Optimisation de la bande...' :
                          exportStatus === 'rendering' ? 'Rendu des images HD' : 'Assemblage final FFmpeg'}
                    </p>
                  </div>
                </div>

                {/* Progress Bar Container */}
                <div className="w-full space-y-6">
                  <div className="relative h-4 w-full bg-zinc-950/50 rounded-full border border-white/5 p-1 overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_20px_rgba(220,38,38,0.3)] relative"
                      style={{ width: `${exportProgress}%` }}
                    >
                      <div className="absolute top-0 right-0 w-8 h-full bg-white/20 blur-sm skew-x-12 translate-x-2"></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                      <p className="text-[9px] uppercase font-bold text-zinc-500 mb-1 tracking-wider">Progression</p>
                      <div className="text-2xl font-black text-white italic tracking-tighter">
                        {exportProgress || 0}<span className="text-sm text-red-600 not-italic ml-1">%</span>
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                      <p className="text-[9px] uppercase font-bold text-zinc-500 mb-1 tracking-wider">Temps restant</p>
                      <div className="text-2xl font-mono text-zinc-200 tracking-tighter">
                        {exportETA || "--:--"}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center px-2">
                    <div className="flex flex-col">
                      <span className="text-[8px] uppercase font-black text-zinc-600 tracking-widest">Temps écoulé</span>
                      <span className="text-[11px] font-mono text-zinc-400">{exportStartTime ? ((performance.now() - exportStartTime) / 1000).toFixed(0) : 0}s</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] uppercase font-black text-zinc-600 tracking-widest">Vitesse</span>
                      <span className="text-[11px] font-mono text-zinc-400">{(duration / ((performance.now() - (exportStartTime || performance.now())) / 1000 || 1)).toFixed(1)}x</span>
                    </div>
                  </div>
                </div>

                {/* Cancel Button */}
                <button
                  onClick={() => {
                    isExportCancelledRef.current = true;
                  }}
                  className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 hover:bg-red-600/10 border border-white/5 hover:border-red-600/30 transition-all duration-300"
                >
                  <X size={14} className="text-zinc-500 group-hover:text-red-500 transition-colors" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 group-hover:text-red-500 transition-colors">Annuler l'export</span>
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Export Settings Modal (V21 Redesign) */}
      {
        isExportModalOpen && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <div className={`p-8 rounded-[32px] w-[500px] shadow-[0_32px_128px_-12px_rgba(0,0,0,1)] relative border border-white/10 ${isDark ? 'bg-zinc-950/40' : 'bg-white/90'}`}>
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-red-600 size-24 rounded-full blur-[80px] opacity-20"></div>

              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className={`text-2xl font-black uppercase tracking-[0.15em] ${isDark ? 'text-white' : 'text-zinc-900'}`}>Exportation</h2>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Configuration du rendu final</p>
                </div>
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className="size-10 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-8 scroll-mask-bottom max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {/* 1. Video Settings */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-red-500">
                    <Video size={16} />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Image & Flux</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1">Résolution</label>
                      <div className="bg-black/40 p-1 rounded-2xl border border-white/5 flex gap-1">
                        {['720p', '1080p'].map((res) => (
                          <button
                            key={res}
                            onClick={() => setExportRes(res as any)}
                            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black tracking-widest transition-all ${exportRes === res ? 'bg-red-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            {res.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1">Débit (Qualité)</label>
                      <select
                        value={exportQuality}
                        onChange={(e) => setExportQuality(e.target.value as any)}
                        className="w-full bg-black/40 p-2.5 rounded-xl border border-white/5 text-[10px] font-black text-zinc-300 outline-none focus:border-red-600 h-[42px]"
                      >
                        <option value="low">BASSE (Vitesse)</option>
                        <option value="medium">STANDARD</option>
                        <option value="high">HAUTE QUALITÉ</option>
                        <option value="ultra">ULTRA HD (Master)</option>
                        <option value="lossless">SANS PERTE</option>
                      </select>
                    </div>
                  </div>

                  <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1 flex justify-between">
                    Fréquence d'images <span>Source: {videoFps?.toFixed(2)} FPS</span>
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    <button
                      onClick={() => setExportFps(videoFps || 25)}
                      className={`py-2 rounded-xl border text-[8px] font-black transition-all leading-tight ${exportFps === videoFps ? 'bg-emerald-500 text-white border-emerald-500' : 'border-white/5 text-zinc-500 hover:border-white/20'}`}
                    >
                      VITESSE<br />VIDÉO
                    </button>
                    {[24, 25, 30, 60].map((fps) => (
                      <button
                        key={fps}
                        onClick={() => setExportFps(fps as any)}
                        className={`py-2 rounded-xl border text-[10px] font-black transition-all ${exportFps === fps ? 'bg-white text-black border-white' : 'border-white/5 text-zinc-500 hover:border-white/20'}`}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Hardware Acceleration */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-blue-500">
                    <Cpu size={16} />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Accélération Matérielle</h3>
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => setExportEncoder('auto')}
                        className={`p-4 rounded-2xl border transition-all text-left flex items-center justify-between ${exportEncoder === 'auto' ? 'bg-blue-600/10 border-blue-500/40 text-blue-400' : 'bg-black/40 border-white/5 text-zinc-500 opacity-60 hover:opacity-100'}`}
                      >
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest">Automatique</p>
                          <p className="text-[8px] opacity-60">Recommandé : VOCAP choisit le meilleur encodeur disponible.</p>
                        </div>
                        {exportEncoder === 'auto' && <div className="size-2 rounded-full bg-blue-500 animate-pulse"></div>}
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'h264_nvenc', label: 'NVIDIA', sub: 'RTX / GTX' },
                          { id: 'h264_amf', label: 'AMD', sub: 'Radeon' },
                          { id: 'h264_qsv', label: 'Intel', sub: 'QuickSync' },
                          { id: 'libx264', label: 'CPU', sub: 'Logiciel' }
                        ].map((enc) => {
                          const isAvailable = enc.id === 'libx264' || (availableEncoders && (availableEncoders[enc.id] || availableEncoders[enc.id.replace('h264_', '')]));
                          return (
                            <button
                              key={enc.id}
                              disabled={!isAvailable}
                              onClick={() => setExportEncoder(enc.id as any)}
                              className={`p-3 rounded-2xl border transition-all text-left group ${!isAvailable ? 'opacity-20 cursor-not-allowed bg-transparent border-white/5' :
                                exportEncoder === enc.id ? 'bg-white border-white text-black' : 'bg-black/40 border-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-200'
                                }`}
                            >
                              <p className="text-[9px] font-black uppercase">{enc.label}</p>
                              <p className={`text-[7px] font-bold ${exportEncoder === enc.id ? 'text-black/60' : 'text-zinc-600'}`}>{enc.sub}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Audio Source */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-emerald-500">
                    <Music size={16} />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Source Audio</h3>
                  </div>

                  <select
                    value={selectedExportAudioPath || 'original'}
                    onChange={(e) => setSelectedExportAudioPath(e.target.value === 'original' ? null : e.target.value)}
                    className="w-full bg-black/40 p-4 rounded-2xl border border-white/5 text-[10px] font-black text-zinc-300 outline-none focus:border-emerald-500"
                  >
                    <option value="original">PISTE VIDÉO D'ORIGINE</option>
                    {audioTracks.map(track => (
                      <option key={track.id} value={track.path}>{track.name.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                {/* 4. Project Portability (Bundle) */}
                <div className={`p-5 rounded-2xl border transition-all ${isDark ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50/50 border-blue-200'}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-8 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                      <FolderOpen size={16} />
                    </div>
                    <div>
                      <h3 className={`text-[11px] font-black uppercase tracking-wider ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Archivage Complet</h3>
                      <p className={`text-[8px] font-bold opacity-60 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Créer un dossier portable avec tous les médias</p>
                    </div>
                  </div>

                  <button
                    onClick={handleBundleProject}
                    disabled={isBundling || isExporting}
                    className={`w-full py-3.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all relative overflow-hidden ${isBundling
                      ? 'bg-blue-600/20 border-blue-500/30 text-blue-400 cursor-wait'
                      : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 hover:scale-[1.02] active:scale-[0.98]'
                      }`}
                  >
                    {isBundling ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="flex items-center gap-2">
                          <RefreshCw size={12} className="animate-spin" />
                          <span>PACKAGING... {bundleProgress.percent}%</span>
                        </div>
                        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-white transition-all duration-300" style={{ width: `${bundleProgress.percent}%` }} />
                        </div>
                        <span className="text-[7px] lowercase opacity-60 font-medium">{bundleProgress.message}</span>
                      </div>
                    ) : (
                      "CRÉER LE BUNDLE PROJET (.ZIP)"
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-white/5 flex gap-4">
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${isDark ? 'bg-white/5 text-zinc-500 hover:text-white hover:bg-white/10' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  Fermer
                </button>
                <button
                  onClick={handleExport}
                  className="flex-[2] py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-red-500 hover:shadow-[0_0_30px_rgba(220,38,38,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Démarrer l'exportation
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Shortcuts Modal */}
      {isShortcutsModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[100] flex items-center justify-center animate-in fade-in zoom-in-95 duration-300">
          <div className="relative w-[850px] max-h-[85vh] flex flex-col shadow-[0_32px_128px_rgba(0,0,0,1)] rounded-[32px] bg-zinc-900/40 border border-white/10 overflow-hidden group">
            {/* Animated Accent */}
            <div className="absolute -top-32 -left-32 w-64 h-64 bg-red-600/5 rounded-full blur-[100px] animate-pulse"></div>

            <div className="relative p-10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-8">
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black uppercase tracking-[0.2em] text-white">Mappage</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-none">Configuration des raccourcis</p>
                </div>
                <button
                  onClick={() => setIsShortcutsModalOpen(false)}
                  className="size-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-600/20 hover:border-red-600/30 transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-4 space-y-10 mb-8 custom-scrollbar max-h-[60vh] relative scroll-mask-bottom">
                {SHORTCUT_CATEGORIES.map((cat) => (
                  <div key={cat.title} className="space-y-5">
                    <div className="flex items-center gap-4">
                      <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#e11d48] shrink-0">{cat.title}</h3>
                      <div className="h-px w-full bg-white/5"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {cat.keys.map((key) => (
                        <ShortcutItem
                          key={key}
                          label={SHORTCUT_LABELS[key] || key}
                          value={(shortcuts as any)[key] || ''}
                          isDark={isDark}
                          onCapture={(newVal) => setShortcuts({ ...shortcuts, [key]: newVal })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-4 pt-6 border-t border-white/5">
                <button
                  onClick={() => {
                    const saved = localStorage.getItem('vocap_shortcuts');
                    setShortcuts(saved ? JSON.parse(saved) : DEFAULT_SHORTCUTS);
                    setIsShortcutsModalOpen(false);
                  }}
                  className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-[11px] font-black uppercase tracking-widest transition-all border border-white/5"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    saveShortcuts(shortcuts);
                    setIsShortcutsModalOpen(false);
                  }}
                  className="flex-1 py-4 rounded-2xl bg-[#e11d48] hover:brightness-110 text-white text-[11px] font-black uppercase tracking-widest transition-all shadow-[0_16px_32px_rgba(225,29,72,0.3)] border border-white/10"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {
        isConsistencyModalOpen && (
          <ConsistencyModal
            phrases={phrases as any}
            characters={characters}
            onClose={() => setIsConsistencyModalOpen(false)}
            onSeek={handleSeek}
          />
        )
      }
    </div >
  );
}

function ShortcutItem({ label, value, isDark, onCapture }: { label: string, value: string, isDark: boolean, onCapture: (v: string) => void }) {
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    if (!isCapturing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const parts = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      const key = e.key === ' ' ? 'Space' : e.key;
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        parts.push(key);
        onCapture(parts.join('+'));
        setIsCapturing(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isCapturing, onCapture]);

  return (
    <div className="flex items-center justify-between p-2 px-3 rounded-xl bg-white/[0.02] border border-white/[0.03] hover:border-white/10 hover:bg-white/[0.04] transition-all group/item">
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500 group-hover/item:text-zinc-300 transition-colors">{label}</span>
      </div>
      <button
        onClick={() => setIsCapturing(true)}
        className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono min-w-[110px] text-center transition-all relative overflow-hidden group/btn ${isCapturing ? 'bg-red-600 border-red-500 text-white shadow-[0_0_20px_rgba(220,38,38,0.4)]' : (isDark ? 'bg-black/40 border-white/5 text-zinc-400 hover:text-white hover:border-[#e11d48]/50' : 'bg-transparent border-zinc-200 text-zinc-600 hover:border-red-600')}`}
      >
        {isCapturing && <div className="absolute inset-0 bg-white/20 animate-pulse"></div>}
        <span className="relative z-10">{isCapturing ? 'Saisie...' : value.toUpperCase()}</span>
      </button>
    </div>
  );
}

function TimecodeDisplay({ fps = 25 }: { fps?: number }) {
  const [displayTime, setDisplayTime] = useState(0);

  useEffect(() => {
    const handleUpdate = (e: any) => {
      setDisplayTime(e.detail.time);
    };
    window.addEventListener('time-update', handleUpdate);
    return () => window.removeEventListener('time-update', handleUpdate);
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * fps);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="text-[18px] font-bold font-mono tracking-widest text-white drop-shadow-[0_0_8px_rgba(225,29,72,0.8)]">
        {formatTime(displayTime)}
      </div>
      <div className="text-[8px] font-black tracking-[0.4em] uppercase text-rose-500/60 -mt-1">
        LIVE TIMECODE
      </div>
    </div>
  );
}

export default App;

