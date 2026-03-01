import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import log from 'electron-log';
import crypto from 'crypto';

let autoUpdater: any = null;
let secondaryWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

// Configure logging
log.transports.file.level = 'info';

// V19 - Dedicated Export Logger
const exportLogger = log.create({ logId: 'export' });
exportLogger.transports.file.fileName = 'export.log';
exportLogger.transports.file.level = 'info';

// V75: Streamlined GPU Acceleration (Stable flags only)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
// Removed: enable-unsafe-webgpu, Vulkan, threaded-compositing (causes flickering or crashes on some drivers)

// Utility to clean Windows paths from file:// or absolute slashes
const cleanPath = (p: string) => {
    if (!p) return "";
    try {
        if (p.startsWith('file://')) {
            return fileURLToPath(p);
        }
        return path.normalize(p);
    } catch (e) {
        log.error('Erreur de nettoyage de chemin:', e, p);
        return p;
    }
};

// Binary resolution helper for ASAR
const getFFmpegPath = () => {
    if (!ffmpegPath) return null;
    if (app.isPackaged) {
        // Robust replacement for asar
        const unpackedPath = ffmpegPath.replace(/[\\/]app\.asar[\\/]/, `${path.sep}app.asar.unpacked${path.sep}`);
        if (fs.existsSync(unpackedPath)) return unpackedPath;
    }
    return ffmpegPath;
};

// V20 - Universal Hardware Acceleration Probes with Verbose Logging
const encoderCache: Record<string, boolean> = {};

const probeEncoder = async (name: string): Promise<boolean> => {
    if (encoderCache[name] !== undefined) return encoderCache[name];

    const ffmpeg = getFFmpegPath();
    if (!ffmpeg) return false;
    return new Promise((resolve) => {
        try {
            // We use a tiny null-render probe to see if the encoder actually initializes
            const proc = spawn(ffmpeg, [
                '-hide_banner',
                '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1',
                '-c:v', name,
                '-f', 'null', '-'
            ]);

            let stderr = '';
            proc.stderr.on('data', (d) => stderr += d.toString());

            proc.on('close', (code) => {
                const available = code === 0;
                if (!available) {
                    exportLogger.warn(`[V20] Probe ${name} failed (code ${code}): ${stderr.trim().split('\n').pop()}`);
                } else {
                    exportLogger.info(`[V20] Probe ${name} success!`);
                }
                encoderCache[name] = available;
                resolve(available);
            });
            proc.on('error', () => resolve(false));
            setTimeout(() => { proc.kill(); resolve(false); }, 3000);
        } catch (e) { resolve(false); }
    });
};

const isNvencAvailable = () => probeEncoder('h264_nvenc');
const isAmfAvailable = () => probeEncoder('h264_amf');
const isQsvAvailable = () => probeEncoder('h264_qsv');
const isMfAvailable = () => probeEncoder('h264_mf'); // Media Foundation (Windows Native)

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        backgroundColor: '#000000',
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
        },
        icon: path.join(__dirname, '../../src/assets/vocap_logo.png')
    });

    // V130: Force App ID for Windows Taskbar Icon consistency
    app.setAppUserModelId('com.vocap.app');

    if (process.env.ELECTRON_RENDERER_URL) {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (secondaryWindow) secondaryWindow.close();
    });
}

function createSecondaryWindow() {
    if (secondaryWindow) {
        secondaryWindow.focus();
        return;
    }

    secondaryWindow = new BrowserWindow({
        width: 800,
        height: 450,
        backgroundColor: '#000000',
        frame: false, // V130: Custom Titlebar
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
        },
        title: 'VOCAP - Sortie Vidéo',
        icon: path.join(__dirname, '../../src/assets/vocap_logo.png') // V130: App Icon
    });

    if (process.env.ELECTRON_RENDERER_URL) {
        secondaryWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#video`);
    } else {
        secondaryWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'video' });
    }

    secondaryWindow.on('closed', () => {
        secondaryWindow = null;
        if (mainWindow) mainWindow.webContents.send('video-window-closed');
    });
}

app.whenReady().then(() => {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.logger = log;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    log.info('[Updater] Version actuelle de l\'application:', app.getVersion());
    log.info('[Updater] Canal de mise à jour:', autoUpdater.channel || 'latest');
    log.info('[Updater] Auto-Download: false, Auto-Install: false');

    Menu.setApplicationMenu(null);
    createWindow();

    // Check for updates after the window is likely ready
    setTimeout(() => {
        log.info('[Updater] Lancement de la vérification initiale (manuelle)...');
        autoUpdater.checkForUpdates().catch((err: any) => {
            log.error('[Updater] Erreur lors du checkForUpdates:', err);
        });
    }, 5000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // --- IPC HANDLERS ---

    // Auto-updater events
    autoUpdater.on('checking-for-update', () => {
        log.info('V??rification des mises ?? jour...');
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update_checking');
        });
    });

    autoUpdater.on('update-available', (info: any) => {
        log.info('Mise ?? jour disponible:', info.version);
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update_available');
        });
    });

    autoUpdater.on('update-not-available', (info: any) => {
        log.info('Aucune mise ?? jour trouv??e. Version locale:', app.getVersion(), 'Serveur:', info.version);
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update_not_available', info.version);
        });
    });

    autoUpdater.on('error', (err: any) => {
        log.error('[Updater] Erreur auto-updater détaillée:', err);
        BrowserWindow.getAllWindows().forEach(win => {
            // Send more info if available
            const msg = (err instanceof Error) ? (err.stack || err.message) : String(err);
            win.webContents.send('update_error', msg);
        });
    });

    autoUpdater.on('update-downloaded', (info: any) => {
        log.info('Mise ?? jour t??l??charg??e:', info.version);
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update_downloaded');
        });
    });

    ipcMain.handle('get-version', () => {
        return app.getVersion();
    });

    ipcMain.handle('check-updates', async () => {
        log.info('[Updater] Vérification manuelle demandée');
        try {
            const result = await autoUpdater.checkForUpdates();
            return result;
        } catch (err: any) {
            log.error('[Updater] Erreur lors du check-updates manuel:', err);
            throw err;
        }
    });

    ipcMain.handle('download-update', async () => {
        log.info('[Updater] Téléchargement manuel demandé');
        try {
            return await autoUpdater.downloadUpdate();
        } catch (err: any) {
            log.error('[Updater] Erreur lors du téléchargement:', err);
            throw err;
        }
    });

    ipcMain.handle('open-video-window', () => {
        createSecondaryWindow();
        return true;
    });

    ipcMain.handle('get-available-encoders', async () => {
        const encoders = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf'];
        const results: Record<string, boolean> = {};
        for (const enc of encoders) {
            results[enc] = await probeEncoder(enc);
        }
        return results;
    });

    ipcMain.on('sync-video-state', (_, state) => {
        if (secondaryWindow && !secondaryWindow.isDestroyed()) {
            secondaryWindow.webContents.send('video-state-update', state);
        }
    });

    ipcMain.on('video-command', (_, cmd) => {
        // From secondary to main
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-command-main', cmd);
        }
    });

    ipcMain.handle('restart-app', () => {
        log.info('[Updater] Redémarrage immédiat demandé (Quit and Install)');
        autoUpdater.quitAndInstall();
    });

    // Window Management
    ipcMain.on('window-minimize', () => {
        BrowserWindow.getFocusedWindow()?.minimize();
    });
    ipcMain.on('window-maximize', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        }
    });
    ipcMain.on('window-close', () => {
        BrowserWindow.getFocusedWindow()?.close();
    });

    // System Fonts Retrieval (Windows Local + Machine)
    ipcMain.handle('get-system-fonts', async () => {
        if (process.platform !== 'win32') return [];
        return new Promise((resolve) => {
            const fonts: Set<string> = new Set();
            let pending = 2;

            const extractFonts = (output: string) => {
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes('REG_SZ') || line.includes('REG_EXPAND_SZ')) {
                        // "Arial (TrueType)    REG_SZ    arial.ttf"
                        const match = line.match(/^\s*(.+?)\s+REG(?:_EXPAND)?_SZ\s+/);
                        if (match && match[1]) {
                            let name = match[1].trim();
                            if (name.includes(' (')) name = name.split(' (')[0];
                            fonts.add(name);
                        }
                    }
                }
            };

            const checkDone = () => {
                pending--;
                if (pending === 0) resolve(Array.from(fonts).sort());
            };

            const procMachine = spawn('reg', ['query', 'HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']);
            let outMachine = '';
            procMachine.stdout.on('data', d => outMachine += d.toString());
            procMachine.on('close', () => { extractFonts(outMachine); checkDone(); });
            procMachine.on('error', () => { checkDone(); });

            const procUser = spawn('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']);
            let outUser = '';
            procUser.stdout.on('data', d => outUser += d.toString());
            procUser.on('close', () => { extractFonts(outUser); checkDone(); });
            procUser.on('error', () => { checkDone(); });
        });
    });

    ipcMain.handle('save-recording', async (_, { buffer, ext }) => {
        const timestamp = new Date().getTime();
        const fileName = `recording_${timestamp}.${ext}`;
        const filePath = path.join(app.getPath('userData'), 'recordings', fileName);

        const folder = path.dirname(filePath);
        if (!require('fs').existsSync(folder)) {
            require('fs').mkdirSync(folder, { recursive: true });
        }

        require('fs').writeFileSync(filePath, Buffer.from(buffer));
        return filePath;
    });

    ipcMain.handle('select-subtitle', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Sous-titres', extensions: ['srt', 'xml'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('select-audio', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('select-video', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return `file://${result.filePaths[0].replace(/\\/g, '/')}`;
    });

    ipcMain.handle('load-project', async () => {
        console.log('Load project request');
        const result = await dialog.showOpenDialog({
            filters: [{ name: 'VOCAP Project', extensions: ['brp'] }],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        return { data: JSON.parse(content), path: result.filePaths[0] };
    });

    ipcMain.handle('load-project-path', async (_, path: string) => {
        try {
            if (!fs.existsSync(path)) return null;
            const content = fs.readFileSync(path, 'utf-8');
            return { data: JSON.parse(content), path };
        } catch (e) {
            console.error('Failed to load project from path:', path, e);
            return null;
        }
    });


    ipcMain.handle('save-project', async (_: any, args: { data: any, defaultPath?: string }) => {
        const { data, defaultPath } = args || {};
        if (!data) {
            log.error('[V126] Save aborted: data is undefined or null');
            return null;
        }

        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showSaveDialog(win!, {
            title: 'Enregistrer le projet',
            defaultPath: defaultPath || 'nouveau_projet.brp',
            filters: [{ name: 'Projet VOCAP', extensions: ['brp'] }]
        });

        if (result.canceled || !result.filePath) return null;

        try {
            const json = JSON.stringify(data, null, 2);
            fs.writeFileSync(result.filePath, json);

            // Verification
            const saved = fs.readFileSync(result.filePath, 'utf-8');
            if (saved !== json) {
                log.error('Save verification failed: content mismatch');
                return null;
            }
            log.info('Project saved and verified:', result.filePath);
            return result.filePath;
        } catch (e) {
            log.error('Save failed:', e);
            return null;
        }
    });



    ipcMain.handle('generate-proxy', async (event, { videoPath, duration }) => {
        const cleanVideoPath = cleanPath(videoPath);
        const proxyPath = cleanVideoPath.replace(/\.[^/.]+$/, "") + "_proxy.mp4";

        return new Promise((resolve) => {
            const actualFfmpegPath = getFFmpegPath();
            if (!actualFfmpegPath) return resolve({ success: false, error: "ffmpeg-static not found" });

            const args = [
                '-y',
                '-i', cleanVideoPath,
                '-vf', 'scale=-2:480',
                '-r', '60', // Force 60fps for ultra-smooth workspace sync
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-c:a', 'aac',
                '-b:a', '128k',
                proxyPath
            ];

            log.info('Lancement de la g??n??ration de proxy:', actualFfmpegPath, args.join(' '));
            const proc = spawn(actualFfmpegPath, args);
            let ffmpegLogs = '';

            proc.stderr.on('data', (data) => {
                const message = data.toString();
                ffmpegLogs += message;
                if (ffmpegLogs.length > 5000) ffmpegLogs = ffmpegLogs.slice(-5000);

                // Extract time=HH:MM:SS.MS
                const timeMatch = message.match(/time=(\d{2}:\d{2}:\d{2}.\d{2})/);
                if (timeMatch && duration > 0) {
                    const timeStr = timeMatch[1];
                    const [hh, mm, ss] = timeStr.split(':').map(parseFloat);
                    const currentSeconds = (hh * 3600) + (mm * 60) + ss;
                    const percent = Math.min(100, Math.round((currentSeconds / duration) * 100));
                    event.sender.send('proxy-progress', percent);
                }
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    log.info('Proxy g??n??r?? avec succ??s:', proxyPath);
                    resolve({ success: true, path: `file://${proxyPath.replace(/\\/g, '/')}` });
                } else {
                    const lastLogs = ffmpegLogs.split('\n').slice(-5).join('\n');
                    log.error('??chec proxy code:', code, 'Logs:', lastLogs);
                    resolve({ success: false, error: `ffmpeg exited with code ${code}.\n${lastLogs}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    });

    ipcMain.handle('select-export-path', async (event, videoPath: string | null) => {
        // V19 - Clear old export log for a fresh session
        try { fs.writeFileSync(exportLogger.transports.file.getFile().path, ''); } catch (e) { }

        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            const desktopPath = app.getPath('desktop');
            const suggestedName = videoPath ? path.basename(videoPath).replace(/\.[^/.]+$/, "") + "_export.mp4" : "export_rythmo.mp4";
            const safeDefaultPath = path.join(desktopPath, suggestedName);

            log.info('[V17] Tentative 1 (Bureau):', safeDefaultPath);
            exportLogger.info('[V17] Tentative 1 (Bureau):', safeDefaultPath);

            let { filePath, canceled } = await dialog.showSaveDialog(win!, {
                title: 'Exporter la vid??o',
                defaultPath: safeDefaultPath,
                buttonLabel: 'Exporter',
                filters: [
                    { name: 'Vid??o MP4', extensions: ['mp4'] },
                    { name: 'Format QuickTime (MOV)', extensions: ['mov'] },
                    { name: 'Autre (MKV)', extensions: ['mkv'] }
                ],
                properties: ['showOverwriteConfirmation', 'createDirectory', 'dontAddToRecent']
            });

            // V17 FALLBACK 1: Rescue Mode (Downloads)
            if (canceled || !filePath) {
                log.info('[V17] Tentative 1 annul??e. Passage ?? la Tentative 2 (T??l??chargements)...');
                exportLogger.info('[V17] Tentative 1 annul??e. Passage ?? la Tentative 2 (T??l??chargements)...');
                const downloadsPath = app.getPath('downloads');
                const rescuePath = path.join(downloadsPath, suggestedName);
                const rescueResult = await dialog.showSaveDialog(win!, {
                    title: 'Exporter la vid??o (Mode Secours : T??l??chargements)',
                    defaultPath: rescuePath,
                    filters: [
                        { name: 'Vid??o MP4', extensions: ['mp4'] },
                        { name: 'Format QuickTime (MOV)', extensions: ['mov'] }
                    ]
                });
                filePath = rescueResult.filePath;
                canceled = rescueResult.canceled;
            }

            // V17 FALLBACK 2: Plan C (Zero Config - Let Windows decide)
            if (canceled || !filePath) {
                log.info('[V17] Tentative 2 annul??e. Passage ?? la Tentative 3 (Z??ro Config)...');
                exportLogger.info('[V17] Tentative 2 annul??e. Passage ?? la Tentative 3 (Z??ro Config)...');
                const zeroResult = await dialog.showSaveDialog(win!, {
                    title: 'Exporter la vid??o (Plan C : Manuel)',
                    filters: [{ name: 'Fichiers Vid??o', extensions: ['mp4', 'mov', 'mkv'] }]
                    // NO defaultPath here, lets Windows pick its last healthy folder
                });
                filePath = zeroResult.filePath;
            }

            if (filePath) {
                log.info('[V17] Chemin s??lectionn?? final:', filePath);
                exportLogger.info('[V17] Chemin s??lectionn?? final:', filePath);
            } else {
                log.info('[V17] Export d??finitivement abandonn?? par l\'utilisateur.');
                exportLogger.info('[V17] Export d??finitivement abandonn?? par l\'utilisateur.');
            }

            return filePath;
        } catch (error) {
            log.error('[V17] ??chec critique du Save Dialog:', error);
            exportLogger.error('[V17] ??chec critique du Save Dialog:', error);
            return null;
        }
    });

    let currentExportFFmpeg: any = null;
    let currentExportAudioPath: string | null = null;

    ipcMain.handle('start-export', async (_, { audioPath, fps, width, height, bandHeight, encoder, quality, outputPath, videoPath }: any) => {
        try {
            const actualFfmpegPath = getFFmpegPath();
            if (!actualFfmpegPath) return { success: false, error: "FFmpeg bin not found" };

            currentExportAudioPath = audioPath || null;
            const cleanVideoPath = cleanPath(videoPath);
            const cleanOutputPath = cleanPath(outputPath);

            // Resolve actual available hardware
            const [hasNvenc, hasAmf, hasQsv, hasMf] = await Promise.all([
                isNvencAvailable(), isAmfAvailable(), isQsvAvailable(), isMfAvailable()
            ]);

            let vEnc = 'libx264';
            let vPreset = 'ultrafast';

            const isAvailable = (name: string) => {
                if (name === 'h264_nvenc') return hasNvenc;
                if (name === 'h264_amf') return hasAmf;
                if (name === 'h264_qsv') return hasQsv;
                if (name === 'h264_mf') return hasMf;
                return true; // libx264
            };

            if (encoder && encoder !== 'auto') {
                if (isAvailable(encoder)) {
                    vEnc = encoder;
                } else {
                    log.warn(`[Export] Requested encoder ${encoder} is not available. Falling back...`);
                    // Fallback hierarchy
                    if (hasMf) vEnc = 'h264_mf';
                    else vEnc = 'libx264';
                }
            } else {
                if (hasNvenc) vEnc = 'h264_nvenc';
                else if (hasAmf) vEnc = 'h264_amf';
                else if (hasQsv) vEnc = 'h264_qsv';
                else if (hasMf) vEnc = 'h264_mf';
            }

            // Set presets based on final choice
            if (vEnc === 'h264_nvenc') vPreset = 'p4';
            else if (vEnc === 'h264_amf') vPreset = 'quality';
            else if (vEnc === 'h264_qsv') vPreset = 'faster';
            else if (vEnc === 'libx264') vPreset = 'veryfast';
            else vPreset = ''; // h264_mf

            let qArgs: string[] = [];
            const q = (quality || 'medium') as keyof typeof crfMap;
            const crfMap = { low: '23', medium: '19', high: '16', ultra: '10', lossless: '0' };
            const nvcMap = { low: '28', medium: '24', high: '20', ultra: '10', lossless: '0' };
            const brMap = { low: '4000k', medium: '10000k', high: '20000k', ultra: '40000k', lossless: '100000k' };

            if (vEnc === 'libx264') {
                qArgs = ['-crf', crfMap[q] || '19'];
            } else if (vEnc === 'h264_nvenc') {
                qArgs = ['-rc', 'vbr', '-cq', nvcMap[q] || '24', '-b:v', brMap[q], '-maxrate', brMap[q]];
            } else if (vEnc === 'h264_qsv') {
                qArgs = ['-global_quality', nvcMap[q] || '24', '-b:v', brMap[q]];
            } else if (vEnc === 'h264_amf') {
                // Fixed V21: Remove unsupported -qv option (deprecated/unrecognized in many builds)
                qArgs = ['-rc', 'vbr_peak', '-b:v', brMap[q], '-maxrate', brMap[q]];
            } else {
                qArgs = ['-b:v', brMap[q], '-maxrate', brMap[q]];
            }

            const isSepAudio = currentExportAudioPath && cleanPath(currentExportAudioPath) !== cleanVideoPath;
            // V17: Removed setpts=PTS-STARTPTS
            // Forcing PTS to 0 on the video without doing it to the audio caused AV desync
            // if the source video had a starting offset. This desync made the text appear "too early/fast".
            const filterComp = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps}[base];[1:v]scale=${width}:${bandHeight}[band];[base][band]overlay=0:H-h:shortest=1:eval=init[outv]`;
            const mapKeys = ['-map', '[outv]', '-map', isSepAudio ? '2:a:0' : '0:a?'];

            const args = [
                '-y',
                '-thread_queue_size', '8192',
                '-i', cleanVideoPath,
                '-framerate', fps.toString(),
                '-f', 'image2pipe', '-vcodec', 'png', '-i', '-',
            ];

            if (isSepAudio) {
                args.push('-thread_queue_size', '8192', '-i', cleanPath(currentExportAudioPath!));
            }

            args.push(
                '-filter_complex', filterComp,
                ...mapKeys,
                '-c:v', vEnc, '-preset', vPreset, ...qArgs, '-pix_fmt', 'yuv420p',
                '-r', fps.toString(), // Output frame rate
                '-fps_mode', 'cfr',   // Force Constant Frame Rate
                '-vsync', 'cfr',      // Alias for newer/older ffmpeg versions
                '-shortest',
                '-c:a', 'aac', '-b:a', '320k',
                '-movflags', '+faststart',
                cleanOutputPath
            );

            log.info('[TURBO] Spawning FFmpeg Streaming:', args.join(' '));
            currentExportFFmpeg = spawn(actualFfmpegPath, args);

            currentExportFFmpeg.stderr.on('data', (d: any) => {
                const msg = d.toString();
                if (msg.includes('time=')) {
                    // Could extract progress here if needed, but renderer tracks frames
                }
                exportLogger.info(`[FFmpeg STREAMPipe] ${msg.trim()}`);
            });

            currentExportFFmpeg.on('error', (err: any) => {
                log.error('[TURBO] FFmpeg Process Error:', err);
            });

            return { success: true };
        } catch (e: any) {
            log.error('[TURBO] Export Start Error:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('send-frame-batch', async (_, { frames }: { frames: string[] }) => {
        if (!currentExportFFmpeg || !currentExportFFmpeg.stdin) return { success: false };

        return new Promise((resolve) => {
            let count = 0;
            const writeOne = () => {
                if (count >= frames.length) return resolve({ success: true });
                const data = frames[count].replace(/^data:image\/(png|jpeg);base64,/, "");
                const buffer = Buffer.from(data, 'base64');

                const canWrite = currentExportFFmpeg.stdin.write(buffer);
                count++;

                if (canWrite) writeOne();
                else currentExportFFmpeg.stdin.once('drain', writeOne);
            };
            writeOne();
        });
    });

    ipcMain.handle('cancel-export', async () => {
        if (currentExportFFmpeg) {
            currentExportFFmpeg.kill('SIGKILL');
            currentExportFFmpeg = null;
        }
        currentExportAudioPath = null;
        return { success: true };
    });

    ipcMain.handle('finish-export', async (_, { outputPath }: any) => {
        if (!currentExportFFmpeg) return { success: false, error: "No export process" };

        return new Promise((resolve) => {
            currentExportFFmpeg.stdin.end();
            currentExportFFmpeg.on('close', (code: number) => {
                currentExportFFmpeg = null;
                if (code === 0) resolve({ success: true, path: outputPath });
                else resolve({ success: false, error: `FFmpeg exited with code ${code}` });
            });
        });
    });
    ipcMain.handle('get-video-metadata', async (_, videoPath: string) => {
        const actualFfmpegPath = getFFmpegPath();
        const cleanPathStr = cleanPath(videoPath);

        return new Promise((resolve) => {
            if (!actualFfmpegPath) return resolve({ fps: 25, duration: 0 });
            console.log('Running FFMPEG Metadata Check:', actualFfmpegPath, cleanPathStr);
            const proc = spawn(actualFfmpegPath, ['-i', cleanPathStr]);
            let output = '';

            // V74 Safety: 5s timeout for metadata extraction
            const timeout = setTimeout(() => {
                log.error('[V74] FFMPEG Metadata Check timed out for:', cleanPathStr);
                proc.kill();
                resolve({ fps: 25, duration: 0 });
            }, 5000);

            proc.stderr.on('data', (data) => {
                output += data.toString();
            });

            proc.on('close', () => {
                clearTimeout(timeout);
                // V14 Refined: Better FPS parsing (handles 23.976, 59.94 etc)
                // Look for 'avg_frame_rate' style or 'fps' label
                const fpsMatch = output.match(/(\d+(\.\d+)?)\s+fps/);
                const tbrMatch = output.match(/(\d+(\.\d+)?)\s+tbr/); // tbr is often more accurate for avg fps
                const fps = tbrMatch ? parseFloat(tbrMatch[1]) : (fpsMatch ? parseFloat(fpsMatch[1]) : 25);

                // Better duration parsing (handles fractional seconds)
                const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
                let duration = 0;
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1]);
                    const mins = parseInt(durationMatch[2]);
                    const secs = parseInt(durationMatch[3]);
                    const msStr = durationMatch[4];
                    const ms = parseInt(msStr) / Math.pow(10, msStr.length);
                    duration = hours * 3600 + mins * 60 + secs + ms;
                }

                resolve({ fps, duration });
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                console.error('Metadata extraction error:', err);
                resolve({ fps: 25, duration: 0 });
            });
        });
    });

    ipcMain.handle('import-detx', async () => {
        const result = await dialog.showOpenDialog({
            filters: [{ name: 'Cappella DETX', extensions: ['detx'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) return null;

        const content = fs.readFileSync(result.filePaths[0], 'utf-8');

        // Helper to convert timecode HH:MM:SS:FF to seconds
        const tcToSeconds = (tc: string, fps = 25) => {
            const parts = tc.split(':').map(part => parseInt(part, 10));
            if (parts.length < 4) return 0;
            const [h, m, s, f] = parts;
            return (h * 3600) + (m * 60) + s + (f / fps);
        };

        // Parse Roles
        const roles: any[] = [];
        const roleRegex = /<role color="([^"]+)" description="[^"]*" id="([^"]+)" name="([^"]+)"\/>/g;
        let roleMatch;
        while ((roleMatch = roleRegex.exec(content)) !== null) {
            roles.push({
                id: roleMatch[2],
                name: roleMatch[3],
                color: roleMatch[1]
            });
        }

        // Parse Lines
        const phrases: any[] = [];
        // Extract each <line> block. It might have attributes in any order.
        const lineBlockRegex = /<line\s+[^>]*role="([^"]+)"[^>]*>([\s\S]*?)<\/line>/g;
        let lineMatch;
        while ((lineMatch = lineBlockRegex.exec(content)) !== null) {
            const roleId = lineMatch[1];
            const innerContent = lineMatch[2];

            // Extract lipsyncs and texts
            const lipsyncs: { time: number, type: string }[] = [];
            // Handle variations in lipsync tag spacing
            const lsRegex = /<lipsync\s+[^>]*timecode="([^"]+)"[^>]*type="([^"]+)"/g;
            let lsMatch;
            while ((lsMatch = lsRegex.exec(innerContent)) !== null) {
                lipsyncs.push({
                    time: tcToSeconds(lsMatch[1]),
                    type: lsMatch[2]
                });
            }

            const texts: string[] = [];
            // In Cappella detx, words/texts are stored in <text>...</text> blocks inside lines.
            const textRegex = /<text>([\s\S]*?)<\/text>/g;
            let tMatch;
            while ((tMatch = textRegex.exec(innerContent)) !== null) {
                texts.push(tMatch[1].trim());
            }

            if (lipsyncs.length >= 2) {
                // Ensure lipsyncs are sorted chronologically
                lipsyncs.sort((a, b) => a.time - b.time);

                const startTime = lipsyncs[0].time;
                const endTime = lipsyncs[lipsyncs.length - 1].time;

                let fullText = texts.join(" || ");

                phrases.push({
                    id: crypto.randomUUID(),
                    characterId: roleId,
                    startTime,
                    endTime,
                    text: fullText,
                    color: roles.find(r => r.id === roleId)?.color || "#ffffff"
                });
            }
        }

        // Apply Broadcast Offset (if starts >= 1 hour, subtract 3600s)
        const minStartTime = phrases.length > 0 ? Math.min(...phrases.map(p => p.startTime)) : 0;
        if (minStartTime >= 3600) {
            phrases.forEach(p => {
                p.startTime -= 3600;
                p.endTime -= 3600;
            });
        }

        return { roles, phrases };
    });

    ipcMain.handle('bundle-project', async (_, { projectData, videoPath, audioTracks }) => {
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win!, {
            title: 'Sélectionner le dossier destination du Bundle',
            properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Annulé' };

        const destRoot = result.filePaths[0];
        const assetsDir = path.join(destRoot, 'assets');
        const audioDir = path.join(assetsDir, 'audio');
        const videoDir = path.join(assetsDir, 'video');

        try {
            // 1. Create structure
            if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
            if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

            const newProjectData = JSON.parse(JSON.stringify(projectData));
            const totalFiles = (videoPath ? 1 : 0) + audioTracks.length;
            let copiedCount = 0;

            const updateProgress = (msg: string) => {
                copiedCount++;
                const percent = Math.round((copiedCount / (totalFiles + 1)) * 100);
                win?.webContents.send('bundle-progress', { percent, message: msg });
            };

            // 2. Copy Video
            if (videoPath) {
                const srcVideo = cleanPath(videoPath);
                if (fs.existsSync(srcVideo)) {
                    const videoExt = path.extname(srcVideo);
                    const videoName = `original_video${videoExt}`;
                    const destVideo = path.join(videoDir, videoName);
                    updateProgress(`Copie de la vidéo...`);
                    fs.copyFileSync(srcVideo, destVideo);
                    newProjectData.videoPath = `assets/video/${videoName}`;
                }
            }

            // 3. Copy Audio Tracks
            const newTracks = [];
            for (const track of audioTracks) {
                const srcAudio = cleanPath(track.path);
                if (fs.existsSync(srcAudio)) {
                    const audioExt = path.extname(srcAudio);
                    const audioName = `${track.id}${audioExt}`;
                    const destAudio = path.join(audioDir, audioName);
                    updateProgress(`Copie de ${track.name}...`);
                    fs.copyFileSync(srcAudio, destAudio);
                    newTracks.push({ ...track, path: `assets/audio/${audioName}` });
                } else {
                    newTracks.push(track); // Keep original if missing
                }
            }
            newProjectData.audioTracks = newTracks;

            // 4. Save bundled project file
            const projectPath = path.join(destRoot, 'project_bundle.brp');
            fs.writeFileSync(projectPath, JSON.stringify(newProjectData, null, 2));

            updateProgress('Terminé !');
            return { success: true, path: projectPath };

        } catch (err: any) {
            log.error('Bundle failed:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('save-project-silent', async (_, args: { data: any, path: string }) => {
        const { data, path: savePath } = args || {};
        if (!data || !savePath) {
            log.error('[V126] Silent save failed: Missing data or path', { hasData: !!data, hasPath: !!savePath });
            return false;
        }
        try {
            const json = JSON.stringify(data, null, 2);
            fs.writeFileSync(savePath, json);

            // Verification
            const saved = fs.readFileSync(savePath, 'utf-8');
            if (saved !== json) {
                log.error('Silent save verification failed');
                return false;
            }
            return true;
        } catch (e) {
            log.error('Silent save failed:', e);
            return false;
        }
    });

    ipcMain.handle('backup-project', async (_, args: { data: any }) => {
        const { data } = args || {};
        if (!data) {
            log.error('[V126] Backup failed: data is undefined');
            return false;
        }
        try {
            const backupDir = path.join(app.getPath('userData'), 'backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

            const timestamp = Date.now();
            const backupPath = path.join(backupDir, `backup_${timestamp}.brp`);
            fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));

            // Rotate backups: keep only last 5
            const files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('backup_') && f.endsWith('.brp'))
                .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
                .sort((a, b) => b.time - a.time);

            if (files.length > 5) {
                files.slice(5).forEach(f => {
                    try { fs.unlinkSync(path.join(backupDir, f.name)); } catch (e) { }
                });
            }
            return true;
        } catch (e) {
            log.error('Backup failed:', e);
            return false;
        }
    });

    ipcMain.handle('check-backup', async () => {
        try {
            const backupDir = path.join(app.getPath('userData'), 'backups');
            if (!fs.existsSync(backupDir)) return null;

            const files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('backup_') && f.endsWith('.brp'))
                .map(f => ({ name: f, path: path.join(backupDir, f), time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
                .sort((a, b) => b.time - a.time);

            if (files.length === 0) return null;

            const latestBackup = files[0];
            const content = fs.readFileSync(latestBackup.path, 'utf-8');
            return { data: JSON.parse(content), path: latestBackup.path, time: latestBackup.time };
        } catch (e) {
            log.error('Check backup failed:', e);
            return null;
        }
    });

    // V86: Removed duplicate get-system-fonts handler here

    // V50: Deep Color Verification Helper
    const getColorAtTime = async (videoPath: string, time: number): Promise<{ r: number, g: number, b: number } | null> => {
        return new Promise((resolve) => {
            const actualFfmpegPath = getFFmpegPath();
            if (!actualFfmpegPath) return resolve(null);

            const args = [
                '-ss', time.toString(),
                '-i', videoPath,
                '-vframes', '1',
                '-vf', 'scale=1:1',
                '-f', 'rawvideo',
                '-c:v', 'rawvideo',
                '-pix_fmt', 'rgb24',
                '-'
            ];

            const proc = spawn(actualFfmpegPath, args);
            let buffer = Buffer.alloc(0);

            proc.stdout.on('data', (data) => {
                buffer = Buffer.concat([buffer, data]);
            });

            proc.on('close', (code) => {
                if (code === 0 && buffer.length >= 3) {
                    resolve({ r: buffer[0], g: buffer[1], b: buffer[2] });
                } else {
                    resolve(null);
                }
            });

            proc.on('error', () => resolve(null));
        });
    };

    ipcMain.handle('detect-scenes', async (_, { videoPath, threshold, minDuration, usePeakDetection, useDeepVerification }: { videoPath: string, threshold?: number, minDuration?: number, usePeakDetection?: boolean, useDeepVerification?: boolean }) => {
        const actualFfmpegPath = getFFmpegPath();
        const cleanPathStr = cleanPath(videoPath);
        const sceneThreshold = threshold || 0.4;
        const sceneMinDuration = minDuration || 0.4;

        return new Promise((resolve) => {
            if (!actualFfmpegPath) return resolve({ success: false, error: 'FFmpeg non trouv??' });

            // Triple-pass engine
            // V53-FIX: Using serial chain (,) instead of multitasking (;) for broader compatibility
            // blackdetect must come before select if we want to catch blacks from the full stream
            const args = [
                '-i', cleanPathStr,
                '-filter_complex', `blackdetect=d=0.1:pix_th=0.1,select='gt(scene,${sceneThreshold})',showinfo`,
                '-f', 'null',
                '-'
            ];

            const proc = spawn(actualFfmpegPath, args);
            const sceneMarkers: number[] = [];
            let candidates: { time: number, score: number }[] = [];
            let blackPassMarkers: number[] = [];
            let lastErrorOutput = '';
            let videoDuration = 0;

            // Optional: Get duration first if not provided (though we usually have it in state)
            // But for progress accuracy, we parse it from the stderr output of the main process if possible

            const parseStream = (data: any) => {
                const out = data.toString();
                lastErrorOutput += out;
                if (lastErrorOutput.length > 5000) lastErrorOutput = lastErrorOutput.slice(-5000); // Keep buffer manageable

                const lines = out.split('\n');
                for (const line of lines) {
                    // Content Pass (Scene Score)
                    if (line.includes('pts_time:')) {
                        const matchTime = line.match(/pts_time:(\d+\.\d+|\d+)/);
                        const matchScore = line.match(/score:(\d+\.\d+|\d+)/);

                        if (matchTime) {
                            const time = parseFloat(matchTime[1]);
                            const score = matchScore ? parseFloat(matchScore[1]) : 1.0;

                            if (usePeakDetection) {
                                candidates.push({ time, score });
                                candidates.sort((a, b) => a.time - b.time);
                            } else {
                                if (time > 0.1 && (sceneMarkers.length === 0 || time - sceneMarkers[sceneMarkers.length - 1] > sceneMinDuration)) {
                                    sceneMarkers.push(time);
                                }
                            }
                        }
                    }

                    // Black Pass (Fades)
                    if (line.includes('black_start:')) {
                        const matchStart = line.match(/black_start:(\d+\.\d+|\d+)/);
                        if (matchStart) blackPassMarkers.push(parseFloat(matchStart[1]));
                    }
                    if (line.includes('black_end:')) {
                        const matchEnd = line.match(/black_end:(\d+\.\d+|\d+)/);
                        if (matchEnd) blackPassMarkers.push(parseFloat(matchEnd[1]));
                    }

                    // Progress Pass (FFmpeg generic stats)
                    if (line.includes('time=')) {
                        const matchTime = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                        if (matchTime) {
                            const hours = parseInt(matchTime[1]);
                            const mins = parseInt(matchTime[2]);
                            const secs = parseInt(matchTime[3]);
                            const ms = parseInt(matchTime[4]);
                            const currentSecs = (hours * 3600) + (mins * 60) + secs + (ms / 100);

                            // Capture duration from the same stream if it appears
                            const matchDuration = out.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                            if (matchDuration && videoDuration === 0) {
                                videoDuration = parseInt(matchDuration[1]) * 3600 + parseInt(matchDuration[2]) * 60 + parseInt(matchDuration[3]);
                            }

                            if (videoDuration > 0) {
                                const percent = Math.min(100, Math.floor((currentSecs / videoDuration) * 100));
                                // @ts-ignore
                                event.sender.send('scene-detection-progress', percent);
                            }
                        }
                    }
                }
            };

            proc.stderr.on('data', parseStream);
            proc.stdout.on('data', parseStream);

            proc.on('close', async (code) => {
                if (code === 0) {
                    let finalCandidates: number[] = [];

                    if (usePeakDetection) {
                        const mergedMarkers: { time: number, score: number }[] = [];

                        if (candidates.length > 0) {
                            candidates.sort((a, b) => a.time - b.time);
                            let currentCluster: { time: number, score: number }[] = [];
                            let lastTime = -1;

                            for (const c of candidates) {
                                // V53: Relaxed window to 0.3s (V49 was 0.3, keep it but relax cluster rejection)
                                if (lastTime === -1 || c.time - lastTime < 0.3) {
                                    currentCluster.push(c);
                                } else {
                                    const clusterDuration = currentCluster[currentCluster.length - 1].time - currentCluster[0].time;
                                    const peak = currentCluster.reduce((prev, current) => (prev.score > current.score) ? prev : current);

                                    // V53 Logic: 
                                    // 1. If very high score (> 0.6) -> KEEP (Confidence Cut)
                                    // 2. If short duration (< 0.20s instead of 0.08) -> KEEP
                                    if (peak.score > 0.6 || clusterDuration <= 0.20) {
                                        mergedMarkers.push(peak);
                                    }
                                    currentCluster = [c];
                                }
                                lastTime = c.time;
                            }
                            if (currentCluster.length > 0) {
                                const clusterDuration = currentCluster[currentCluster.length - 1].time - currentCluster[0].time;
                                const peak = currentCluster.reduce((prev, current) => (prev.score > current.score) ? prev : current);
                                if (peak.score > 0.6 || clusterDuration <= 0.20) mergedMarkers.push(peak);
                            }
                        }

                        // V53 Color Pass
                        for (const peak of mergedMarkers) {
                            if (useDeepVerification) {
                                // Bypass color check for very strong cuts
                                if (peak.score > 0.65) {
                                    finalCandidates.push(peak.time);
                                    continue;
                                }

                                const colorBefore = await getColorAtTime(cleanPathStr, Math.max(0, peak.time - 0.1));
                                const colorAfter = await getColorAtTime(cleanPathStr, peak.time + 0.1);

                                if (colorBefore && colorAfter) {
                                    const dist = Math.sqrt(
                                        Math.pow(colorBefore.r - colorAfter.r, 2) +
                                        Math.pow(colorBefore.g - colorAfter.g, 2) +
                                        Math.pow(colorBefore.b - colorAfter.b, 2)
                                    );
                                    // V53: Lower color threshold to 20
                                    if (dist > 20) finalCandidates.push(peak.time);
                                } else {
                                    finalCandidates.push(peak.time);
                                }
                            } else {
                                finalCandidates.push(peak.time);
                            }
                        }
                    } else {
                        finalCandidates = [...sceneMarkers];
                    }

                    // Add markers from black detection (fades)
                    blackPassMarkers.forEach(bm => {
                        if (!finalCandidates.find(fc => Math.abs(fc - bm) < 0.5)) {
                            finalCandidates.push(bm);
                        }
                    });

                    // V67 - Starting Scene Detection (High Sensitivity)
                    log.info(`[V67] Starting Scene Detection (High Sensitivity)...`);
                    resolve({ success: true, markers: finalCandidates.sort((a, b) => a - b) });
                } else {
                    const errorMsg = lastErrorOutput.split('\n').filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('failed')).slice(-3).join('\n');
                    resolve({ success: false, error: errorMsg || `FFmpeg a quitt?? avec le code ${code}` });
                }
            });
        });
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
