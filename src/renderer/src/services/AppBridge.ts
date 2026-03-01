/**
 * AppBridge.ts
 * Manages the connection between the UI and video processing.
 * Pure Electron implementation (restored pre-web state).
 */

export const isWebEnvironment = false;

export const AppBridge = {
    // --- FILE MANAGEMENT ---
    selectVideo: async (): Promise<string | null> => {
        return await window.electron.selectVideo();
    },

    selectAudio: async (): Promise<string | null> => {
        return await (window.electron as any).ipcRenderer.invoke('select-audio');
    },

    selectSubtitle: async (): Promise<string | null> => {
        return await (window.electron as any).ipcRenderer.invoke('select-subtitle');
    },

    saveRecording: async (buffer: ArrayBuffer, ext: string): Promise<string> => {
        return await (window.electron as any).ipcRenderer.invoke('save-recording', { buffer, ext });
    },

    loadProject: async (): Promise<{ data: any, path: string } | null> => {
        return await window.electron.loadProject();
    },
    loadProjectPath: async (path: string): Promise<{ data: any, path: string } | null> => {
        return await (window.electron as any).loadProjectPath(path);
    },

    saveProject: async (data: any): Promise<string | null> => {
        return await window.electron.saveProject({ data });
    },

    saveProjectSilent: async (data: any, path: string): Promise<boolean> => {
        return await window.electron.saveProjectSilent({ data, path });
    },

    importDetx: async (): Promise<any | null> => {
        return await window.electron.importDetx();
    },

    backupProject: async (data: any): Promise<boolean> => {
        return await window.electron.backupProject({ data });
    },

    checkBackup: async (): Promise<{ data: any, path: string, time: number } | null> => {
        return await window.electron.checkBackup();
    },

    // --- VIDEO PROCESSING ---
    selectExportPath: async (videoSrc: string | null): Promise<string | null> => {
        return await window.electron.selectExportPath(videoSrc as string);
    },

    detectScenes: async (videoPath: string, threshold: number, minDuration: number, usePeakDetection: boolean, useDeepVerification: boolean): Promise<{ success: boolean, markers?: number[], error?: string }> => {
        return await window.electron.ipcRenderer.invoke('detect-scenes', { videoPath, threshold, minDuration, usePeakDetection, useDeepVerification });
    },

    generateProxy: async (videoPath: string, duration: number): Promise<{ success: boolean, path?: string, error?: string }> => {
        return await (window.electron as any).generateProxy({ videoPath, duration });
    },

    getVideoMetadata: async (videoPath: string): Promise<{ fps: number, duration: number }> => {
        return await window.electron.getVideoMetadata(videoPath);
    },

    getSystemFonts: async (): Promise<string[]> => {
        return await window.electron.getSystemFonts();
    },

    startExport: async (options: {
        audioPath?: string,
        fps: number,
        width: number,
        height: number,
        bandHeight: number,
        encoder?: string,
        quality?: string,
        outputPath: string,
        videoPath: string
    }): Promise<boolean> => {
        return await window.electron.startExport(options);
    },

    sendFrameBatch: async (options: { frames: string[] }): Promise<boolean> => {
        return await window.electron.sendFrameBatch(options);
    },

    finishExport: async (options: { outputPath: string }): Promise<{ success: boolean, path?: string, error?: string }> => {
        return await window.electron.finishExport(options);
    },

    cancelExport: async (): Promise<boolean> => {
        return await (window.electron as any).cancelExport?.() || true;
    },

    // --- SECONDARY VIDEO WINDOW ---
    openVideoWindow: async (): Promise<boolean> => {
        return await (window.electron as any).openVideoWindow();
    },

    syncVideoState: (state: any) => {
        (window.electron as any).syncVideoState(state);
    },

    sendVideoCommand: (cmd: any) => {
        (window.electron as any).sendVideoCommand(cmd);
    },

    bundleProject: async (projectData: any, videoPath: string | null, audioTracks: any[]): Promise<{ success: boolean, path?: string, error?: string }> => {
        return await (window.electron as any).ipcRenderer.invoke('bundle-project', { projectData, videoPath, audioTracks });
    }
};
