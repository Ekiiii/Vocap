"use strict";
const { contextBridge, ipcRenderer } = require("electron");
if (contextBridge) {
  contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
      send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      on: (channel, func) => {
        const subscription = (_event, ...args) => func(...args);
        ipcRenderer.on(channel, subscription);
        return subscription;
      },
      off: (channel, subscription) => ipcRenderer.removeListener(channel, subscription),
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
    },
    selectVideo: () => ipcRenderer.invoke("select-video"),
    saveProject: (...args) => ipcRenderer.invoke("save-project", ...args),
    loadProject: () => ipcRenderer.invoke("load-project"),
    loadProjectPath: (path) => ipcRenderer.invoke("load-project-path", path),
    startExport: (...args) => ipcRenderer.invoke("start-export", ...args),
    sendFrameBatch: (...args) => ipcRenderer.invoke("send-frame-batch", ...args),
    finishExport: (...args) => ipcRenderer.invoke("finish-export", ...args),
    generateProxy: (...args) => ipcRenderer.invoke("generate-proxy", ...args),
    getVideoMetadata: (...args) => ipcRenderer.invoke("get-video-metadata", ...args),
    selectExportPath: (...args) => ipcRenderer.invoke("select-export-path", ...args),
    importDetx: () => ipcRenderer.invoke("import-detx"),
    getSystemFonts: () => ipcRenderer.invoke("get-system-fonts"),
    detectScenes: (...args) => ipcRenderer.invoke("detect-scenes", ...args),
    saveProjectSilent: (...args) => ipcRenderer.invoke("save-project-silent", ...args),
    backupProject: (...args) => ipcRenderer.invoke("backup-project", ...args),
    checkBackup: () => ipcRenderer.invoke("check-backup"),
    installModel: (...args) => ipcRenderer.invoke("install-model", ...args),
    getModelStatus: () => ipcRenderer.invoke("get-model-status"),
    getGpuInfo: () => ipcRenderer.invoke("get-gpu-info"),
    openVideoWindow: () => ipcRenderer.invoke("open-video-window"),
    syncVideoState: (state) => ipcRenderer.send("sync-video-state", state),
    sendVideoCommand: (cmd) => ipcRenderer.send("video-command", cmd),
    downloadUpdate: () => ipcRenderer.invoke("download-update"),
    restartApp: () => ipcRenderer.invoke("restart-app")
  });
}
