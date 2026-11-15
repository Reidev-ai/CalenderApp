import type { EventEmitter } from "node:events";
import type { UpdateStatus } from "../src/updateTypes.js";

export interface Updater extends EventEmitter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  disableWebInstaller: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export class UpdateManager {
  private status: UpdateStatus;
  private checking = false;
  private downloading: Promise<void> | null = null;

  constructor(private updater: Updater | null, version: string,
    private notify: (status: UpdateStatus) => void, private prepareInstall: () => Promise<void>) {
    this.status = { phase: updater ? "idle" : "disabled", currentVersion: version };
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.on("checking-for-update", () => this.set({ phase: "checking", message: undefined }));
    updater.on("update-available", (info: { version: string }) => this.set({ phase: "available", version: info.version, percent: undefined, message: undefined }));
    updater.on("update-not-available", () => this.set({ phase: "idle", version: undefined, percent: undefined, message: undefined }));
    updater.on("download-progress", (progress: { percent: number }) => {
      if (this.status.phase === "downloading") this.set({ percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.floor(progress.percent))) : 0 });
    });
    updater.on("update-downloaded", (info: { version: string }) => this.set({ phase: "downloaded", version: info.version, percent: 100, message: undefined }));
    updater.on("update-cancelled", () => this.set({ phase: "available", percent: undefined }));
    updater.on("error", () => this.fail());
  }

  getStatus() { return { ...this.status }; }

  async check() {
    if (!this.updater || this.checking || this.downloading || ["downloaded", "installing"].includes(this.status.phase)) return this.getStatus();
    this.checking = true;
    this.set({ phase: "checking", message: undefined });
    try { await this.updater.checkForUpdates(); }
    catch { this.fail(); }
    finally { this.checking = false; }
    return this.getStatus();
  }

  async download() {
    if (this.downloading) { await this.downloading; return this.getStatus(); }
    if (!this.updater || !this.status.version || !["available", "error"].includes(this.status.phase)) throw new Error("ダウンロードできる更新はありません");
    this.set({ phase: "downloading", percent: 0, message: undefined });
    this.downloading = (async () => {
      try { await this.updater!.downloadUpdate(); }
      catch { this.fail(); }
    })();
    try { await this.downloading; }
    finally { this.downloading = null; }
    return this.getStatus();
  }

  async install() {
    if (this.status.phase === "installing") return this.getStatus();
    if (!this.updater || this.status.phase !== "downloaded") throw new Error("更新のダウンロードが完了していません");
    this.set({ phase: "installing", message: undefined });
    try {
      await this.prepareInstall();
      this.updater.quitAndInstall(true, true);
    } catch { this.fail(); }
    return this.getStatus();
  }

  private fail() { this.set({ phase: "error", message: "更新できませんでした。接続を確認して再試行してください。" }); }
  private set(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch };
    this.notify(this.getStatus());
  }
}
