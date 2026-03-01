const { contextBridge, ipcRenderer } = require('electron');

if (contextBridge) {
    contextBridge.exposeInMainWorld('electron', {
        ipcRenderer: {
            send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
            on: (channel: string, func: (...args: any[]) => void) => {
                const subscription = (_event: any, ...args: any[]) => func(...args);
                ipcRenderer.on(channel, subscription);
                return subscription;
            },
            off: (channel: string, subscription: any) => ipcRenderer.removeListener(channel, subscription),
            invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
            removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
        },
        selectVideo: () => ipcRenderer.invoke('select-video'),
        saveProject: (...args: any[]) => ipcRenderer.invoke('save-project', ...args),
        loadProject: () => ipcRenderer.invoke('load-project'),
        loadProjectPath: (path: string) => ipcRenderer.invoke('load-project-path', path),
        startExport: (...args: any[]) => ipcRenderer.invoke('start-export', ...args),
        sendFrameBatch: (...args: any[]) => ipcRenderer.invoke('send-frame-batch', ...args),
        finishExport: (...args: any[]) => ipcRenderer.invoke('finish-export', ...args),
        generateProxy: (...args: any[]) => ipcRenderer.invoke('generate-proxy', ...args),
        getVideoMetadata: (...args: any[]) => ipcRenderer.invoke('get-video-metadata', ...args),
        selectExportPath: (...args: any[]) => ipcRenderer.invoke('select-export-path', ...args),
        importDetx: () => ipcRenderer.invoke('import-detx'),
        getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
        detectScenes: (...args: any[]) => ipcRenderer.invoke('detect-scenes', ...args),
        saveProjectSilent: (...args: any[]) => ipcRenderer.invoke('save-project-silent', ...args),
        backupProject: (...args: any[]) => ipcRenderer.invoke('backup-project', ...args),
        checkBackup: () => ipcRenderer.invoke('check-backup'),
        installModel: (...args: any[]) => ipcRenderer.invoke('install-model', ...args),
        getModelStatus: () => ipcRenderer.invoke('get-model-status'),
        getGpuInfo: () => ipcRenderer.invoke('get-gpu-info'),
        openVideoWindow: () => ipcRenderer.invoke('open-video-window'),
        syncVideoState: (state: any) => ipcRenderer.send('sync-video-state', state),
        sendVideoCommand: (cmd: any) => ipcRenderer.send('video-command', cmd),
        downloadUpdate: () => ipcRenderer.invoke('download-update'),
        restartApp: () => ipcRenderer.invoke('restart-app'),
    });
}
