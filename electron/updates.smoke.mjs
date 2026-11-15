import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "playwright";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "calender-update-ui-"));
const artifacts = resolve(".artifacts/updates");
await mkdir(artifacts, { recursive: true });
const env = { ...process.env, CALENDAR_DESKTOP_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app;
let page;
const errors = [];

async function emit(status) {
  await app.evaluate(({ BrowserWindow }, status) => {
    globalThis.testUpdateState = { currentVersion: "0.1.1", ...status };
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updates:status", globalThis.testUpdateState);
    if (["downloaded", "error"].includes(status.phase) && globalThis.finishTestDownload) {
      globalThis.finishTestDownload(globalThis.testUpdateState);
      globalThis.finishTestDownload = null;
    }
  }, status);
}

async function counts() { return app.evaluate(() => globalThis.testUpdateActions); }
async function remainWaitingForRestart() {
  await page.getByRole("button", { name: "アプリを再起動して更新", exact: true }).waitFor();
  // Give effects/timeouts time to run, so the former automatic restart fails this test.
  await page.waitForTimeout(300);
  assert.equal((await counts()).install, 0);
}

try {
  app = await _electron.launch({ executablePath: require("electron"), args: [resolve(".")], env, timeout: 45000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "メンバー管理", exact: true }).waitFor();
  assert.equal(await page.locator(".desktop-update-button").count(), 0);
  // Stub only the test process IPC. No release is fetched and no installer is run.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.testUpdateState = { phase: "idle", currentVersion: "0.1.1" };
    globalThis.testUpdateActions = { download: 0, install: 0 };
    ipcMain.removeHandler("updates:status");
    ipcMain.removeHandler("updates:action");
    ipcMain.handle("updates:status", () => globalThis.testUpdateState);
    ipcMain.handle("updates:action", (_event, action) => {
      globalThis.testUpdateActions[action]++;
      const phase = action === "download" ? "downloading" : "installing";
      globalThis.testUpdateState = { ...globalThis.testUpdateState, phase, percent: 0 };
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updates:status", globalThis.testUpdateState);
      if (action === "download") return new Promise((resolve) => { globalThis.finishTestDownload = resolve; });
      return globalThis.testUpdateState;
    });
  });
  await emit({ phase: "error", message: "offline" });
  assert.equal(await page.locator(".desktop-update-button").count(), 0);
  await emit({ phase: "available", version: "0.1.2" });
  await page.getByRole("button", { name: "更新", exact: true }).waitFor();
  for (const width of [1280, 1120, 980]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 840), width);
    await page.screenshot({ path: join(artifacts, `available-${width}.png`) });
    const bounds = await page.locator(".desktop-update-button").boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, paddingRight: parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingRight) }));
    assert.equal(bounds.width, 160);
    assert.equal(bounds.height, 28);
    assert.ok(bounds.x + bounds.width <= viewport.width - viewport.paddingRight + 0.5);
    assert.ok(viewport.scrollWidth <= viewport.width);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));
  await page.getByRole("button", { name: "新規作成", exact: true }).first().click();
  await page.getByLabel("現場名", { exact: true }).fill("保存前の編集内容");
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await page.getByText("編集中の内容を保存またはキャンセルしてから更新してください。", { exact: true }).waitFor();
  assert.deepEqual(await counts(), { download: 0, install: 0 });
  assert.equal(await page.getByLabel("現場名", { exact: true }).inputValue(), "保存前の編集内容");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".month-task-chip").filter({ hasText: "保存前の編集内容" }).waitFor();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await emit({ phase: "downloading", version: "0.1.2", percent: 61 });
  assert.ok(await page.getByRole("button", { name: "更新 61%", exact: true }).isDisabled());
  await page.screenshot({ path: join(artifacts, "progress.png") });
  await page.getByRole("button", { name: "新規作成", exact: true }).first().click();
  await page.getByLabel("現場名", { exact: true }).fill("ダウンロード中の編集内容");
  await emit({ phase: "downloaded", version: "0.1.2", percent: 100 });
  await remainWaitingForRestart();
  assert.deepEqual(await counts(), { download: 1, install: 0 });
  await page.screenshot({ path: join(artifacts, "waiting-for-save.png") });
  await page.getByRole("button", { name: "アプリを再起動して更新", exact: true }).click();
  assert.deepEqual(await counts(), { download: 1, install: 0 });
  assert.equal(await page.getByLabel("現場名", { exact: true }).inputValue(), "ダウンロード中の編集内容");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await remainWaitingForRestart();
  for (const width of [1280, 1120, 980]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 840), width);
    const fits = await page.locator(".desktop-update-button").evaluate(button => {
      const label = button.querySelector("span").getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(button.closest('.topbar')).paddingRight);
      return label.left >= bounds.left && label.right <= bounds.right && bounds.right <= innerWidth - padding + 0.5 && document.documentElement.scrollWidth <= innerWidth;
    });
    assert.ok(fits, `Restart button text must fit at ${width}px`);
    await page.screenshot({ path: join(artifacts, `ready-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));
  await page.getByRole("button", { name: "アプリを再起動して更新", exact: true }).click();
  await page.getByRole("button", { name: "更新中", exact: true }).waitFor();
  assert.deepEqual(await counts(), { download: 1, install: 1 });
  await emit({ phase: "error", version: "0.1.2", message: "retry" });
  await page.getByRole("button", { name: "更新を再試行", exact: true }).click();
  await page.getByRole("button", { name: "更新 0%", exact: true }).waitFor();
  await emit({ phase: "error", version: "0.1.2", message: "offline" });
  await page.getByRole("button", { name: "更新を再試行", exact: true }).waitFor();
  assert.deepEqual(await counts(), { download: 2, install: 1 });
  await page.getByRole("button", { name: "更新を再試行", exact: true }).click();
  await emit({ phase: "downloaded", version: "0.1.2", percent: 100 });
  await page.getByRole("button", { name: "アプリを再起動して更新", exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(await counts(), { download: 3, install: 1 });
  await page.reload();
  await page.getByRole("button", { name: "アプリを再起動して更新", exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(await counts(), { download: 3, install: 1 });
  assert.deepEqual(errors, []);
  console.log("PASS: update UI at 3 widths, progress, download-only first click, no automatic restart after download/save/retry/remount, explicit restart action, unsaved-edit guard");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifacts, "failure.png") });
    console.error((await page.locator("body").innerText()).slice(-3000));
  }
  throw error;
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
