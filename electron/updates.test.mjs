import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { UpdateManager } from "../dist-electron/electron/updates.js";

class FakeUpdater extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = [];
  nextVersion = "0.1.2";
  checkError = false;
  downloadError = false;
  releaseDownload = null;
  async checkForUpdates() {
    this.checks++;
    if (this.checkError) throw new Error("network unavailable");
    this.emit(this.nextVersion ? "update-available" : "update-not-available", { version: this.nextVersion });
  }
  async downloadUpdate() {
    this.downloads++;
    if (this.downloadError) { this.emit("error", new Error("checksum mismatch")); throw new Error("failed"); }
    await new Promise((resolve) => { this.releaseDownload = resolve; });
    this.emit("update-downloaded", { version: this.nextVersion });
  }
  quitAndInstall(...args) { this.installs.push(args); }
}

function setup(prepare = async () => {}) {
  const updater = new FakeUpdater();
  const states = [];
  const manager = new UpdateManager(updater, "0.1.1", (state) => states.push(state), prepare);
  return { updater, manager, states };
}

test("checks do not download or install; stable updates only with downgrade prevention", async () => {
  const { manager, updater } = setup();
  await manager.check();
  assert.equal(manager.getStatus().phase, "available");
  assert.equal(manager.getStatus().version, "0.1.2");
  assert.equal(updater.downloads, 0);
  assert.deepEqual(updater.installs, []);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableWebInstaller, true);
});

test("download waits for explicit installation, then backs up and restarts once", async () => {
  let backedUp = false;
  const { manager, updater } = setup(async () => { backedUp = true; });
  await manager.check();
  const first = manager.download();
  const second = manager.download();
  assert.equal(updater.downloads, 1);
  updater.emit("download-progress", { percent: 42.8 });
  assert.equal(manager.getStatus().percent, 42);
  await manager.check();
  assert.equal(updater.checks, 1);
  updater.releaseDownload();
  await Promise.all([first, second]);
  assert.equal(manager.getStatus().phase, "downloaded");
  assert.deepEqual(updater.installs, []);
  const install = manager.install();
  assert.equal(manager.getStatus().phase, "installing");
  await Promise.all([install, manager.install()]);
  assert.ok(backedUp);
  assert.deepEqual(updater.installs, [[true, true]]);
});

test("latest version and offline check do not offer an installer", async () => {
  const { manager, updater } = setup();
  updater.nextVersion = null;
  await manager.check();
  assert.equal(manager.getStatus().phase, "idle");
  assert.equal(manager.getStatus().version, undefined);
  updater.checkError = true;
  await manager.check();
  assert.equal(manager.getStatus().phase, "error");
  assert.equal(manager.getStatus().version, undefined);
  assert.deepEqual(updater.installs, []);
});

test("failed download or integrity check never installs and can be retried", async () => {
  const { manager, updater } = setup();
  await manager.check();
  updater.downloadError = true;
  await manager.download();
  assert.equal(manager.getStatus().phase, "error");
  await assert.rejects(manager.install());
  updater.downloadError = false;
  const download = manager.download();
  updater.releaseDownload();
  await download;
  assert.equal(manager.getStatus().phase, "downloaded");
  assert.equal(updater.downloads, 2);
  assert.deepEqual(updater.installs, []);
});

test("backup failure prevents installation", async () => {
  const { manager, updater } = setup(async () => { throw new Error("disk full"); });
  await manager.check();
  const download = manager.download();
  updater.releaseDownload();
  await download;
  await manager.install();
  assert.equal(manager.getStatus().phase, "error");
  assert.deepEqual(updater.installs, []);
});

test("development and unsupported platforms never start updating", async () => {
  const manager = new UpdateManager(null, "0.1.1", () => assert.fail("unexpected notification"), async () => {});
  assert.equal((await manager.check()).phase, "disabled");
  await assert.rejects(manager.download());
  await assert.rejects(manager.install());
});
