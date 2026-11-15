import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFile, rename, stat } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import electronUpdater from "electron-updater";
import { LocalCalendar } from "./localCalendar.js";
import { UpdateManager } from "./updates.js";
import type { UpdateStatus } from "../src/updateTypes.js";
import type { DesktopRequest, DesktopResponse } from "../src/desktop.js";

const here = dirname(fileURLToPath(import.meta.url));
app.setName("Calender");
app.setPath("userData", join(app.getPath("appData"), "Calender"));
let store: LocalCalendar;
let shuttingDown = false;
let updates: UpdateManager;
let updateTimer: ReturnType<typeof setInterval> | undefined;
let updateLogQueue = Promise.resolve();
if (!app.isPackaged && process.env.CALENDAR_DESKTOP_TEST_DATA_DIR) app.setPath("userData", process.env.CALENDAR_DESKTOP_TEST_DATA_DIR);

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280, height: 840, minWidth: 980, minHeight: 680, backgroundColor: "#f5f7fb",
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const rendererUrl = getRendererUrl();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] !== rendererUrl.split("#")[0]) {
      event.preventDefault();
      if (url.startsWith("mailto:")) void shell.openExternal(url);
    }
  });
  if (!process.env.ELECTRON_RENDERER_URL || app.isPackaged) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"] },
    }));
  }
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await mainWindow.loadURL(rendererUrl);
  mainWindow.setTitle("Calender - シフト管理");
}

function getRendererUrl() {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(join(app.getAppPath(), "dist", "index.html")).href;
}

function isTrustedRenderer(event: IpcMainInvokeEvent) {
  return Boolean(BrowserWindow.fromWebContents(event.sender)) && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url.split("#")[0] === getRendererUrl();
}

function broadcastUpdate(status: UpdateStatus) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updates:status", status);
  if (status.phase === "downloading") return;
  updateLogQueue = updateLogQueue.then(async () => {
    const path = join(app.getPath("userData"), "updater.log");
    if (((await stat(path).catch(() => null))?.size ?? 0) > 1024 * 1024) await rename(path, `${path}.previous`);
    await appendFile(path, `${JSON.stringify({ time: new Date().toISOString(), phase: status.phase, version: status.version })}\n`);
  }).catch(() => undefined);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.reidevai.calender");
    try {
      const wasmPath = app.isPackaged ? join(process.resourcesPath, "sql-wasm.wasm") : join(app.getAppPath(), "node_modules/sql.js/dist/sql-wasm.wasm");
      store = await LocalCalendar.open(app.getPath("userData"), wasmPath);
      const updater = app.isPackaged && process.platform === "win32" ? electronUpdater.autoUpdater : null;
      if (updater) updater.logger = null;
      updates = new UpdateManager(updater, app.getVersion(), broadcastUpdate, () => store.backupBeforeUpdate());
      ipcMain.handle("updates:status", (event) => {
        if (!isTrustedRenderer(event)) throw new Error("許可されていない操作です");
        return updates.getStatus();
      });
      ipcMain.handle("updates:action", (event, action: unknown) => {
        if (!isTrustedRenderer(event) || shuttingDown) throw new Error("許可されていない操作です");
        if (action === "download") return updates.download();
        if (action === "install") return updates.install();
        throw new Error("許可されていない操作です");
      });
      ipcMain.handle("calendar:request", async (event, request: DesktopRequest): Promise<DesktopResponse> => {
        if (!isTrustedRenderer(event) || shuttingDown || updates.getStatus().phase === "installing") {
          return { ok: false, error: "許可されていない操作です" };
        }
        try { return { ok: true, data: await store.request(request) }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : "PCへの保存に失敗しました" }; }
      });
      await createMainWindow();
      if (updater) {
        void updates.check();
        updateTimer = setInterval(() => { void updates.check(); }, 6 * 60 * 60 * 1000);
        updateTimer.unref();
      }
      app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) void createMainWindow(); });
    } catch (error) {
      dialog.showErrorBox("シフト管理を起動できません", `${error instanceof Error ? error.message : error}\n保存済みデータは削除していません。`);
      app.quit();
    }
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", (event) => {
    if (!store || shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    if (updateTimer) clearInterval(updateTimer);
    void store.close().finally(() => app.quit());
  });
}
