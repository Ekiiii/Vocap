export interface IElectronAPI {
    ipcRenderer: {
        send: (channel: string, data: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => any;
        off: (channel: string, subscription: any) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
    selectVideo: () => Promise<string | null>;
    saveProject: (data: any) => Promise<any>;
    loadProject: () => Promise<any>;
    startExport: (data?: { audioPath?: string }) => Promise<any>;
    sendFrameBatch: (data: any) => Promise<any>;
    finishExport: (data: any) => Promise<any>;
    generateProxy: (data: { videoPath: string, duration: number }) => Promise<any>;
    getVideoMetadata: (videoPath: string) => Promise<any>;
    selectExportPath: (defaultPath?: string) => Promise<any>;
    importDetx: () => Promise<any>;
    getSystemFonts: () => Promise<string[]>;
    detectScenes: (data: any) => Promise<any>;
    saveProjectSilent: (data: any) => Promise<any>;
    backupProject: (data: any) => Promise<any>;
    checkBackup: () => Promise<any>;
    installModel: (data: { modelSize: string }) => Promise<{ success: boolean, error?: string }>;
    getModelStatus: () => Promise<any>;
    getGpuInfo: () => Promise<{ success: boolean, providers: string[], active: string, detectedPath?: string, sessionError?: string | null, env?: any, error?: string }>;
    downloadUpdate: () => Promise<any>;
    restartApp: () => Promise<any>;
}

declare global {
    interface Window {
        electron: IElectronAPI;
    }
}
