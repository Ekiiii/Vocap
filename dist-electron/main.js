import electron from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = electron;
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
protocol.registerSchemesAsPrivileged([
  { scheme: "local-video", privileges: { bypassCSP: true, stream: true } }
]);
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: "#000000",
    title: "Bande Rythmo - Revival"
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
}
app.whenReady().then(() => {
  protocol.handle("local-video", (request) => {
    const filePath = decodeURIComponent(request.url.replace("local-video://", ""));
    try {
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error("Failed to fetch local video:", error);
      return new Response("File not found", { status: 404 });
    }
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
ipcMain.handle("select-video", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mkv", "avi", "mov", "webm"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return `local-video://${encodeURIComponent(result.filePaths[0])}`;
});
