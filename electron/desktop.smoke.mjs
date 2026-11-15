import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";

const { _electron } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "calender-desktop-ui-"));
const artifacts = resolve(".artifacts/desktop");
await mkdir(artifacts, { recursive: true });
const env = { ...process.env, CALENDAR_DESKTOP_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app;
let lastPage;
const errors = [];

async function launch() {
  app = await _electron.launch({ executablePath: require("electron"), args: [resolve(".")], env, timeout: 45000 });
  const page = await app.firstWindow();
  lastPage = page;
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("RENDERER:", message.text()); });
  await page.getByRole("button", { name: "メンバー管理", exact: true }).waitFor();
  return page;
}

async function createShift(page, name, members) {
  await page.getByRole("button", { name: "新規作成", exact: true }).first().click();
  await page.getByLabel("現場名", { exact: true }).fill(name);
  await page.locator(".member-field").getByRole("button", { name: "メンバーを追加", exact: true }).click();
  for (const member of members) await page.locator(".member-choice-list").getByRole("button", { name: member, exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".month-task-chip").filter({ hasText: name }).waitFor();
}

async function download(page, buttonName, fileName) {
  // Electron uses its native download/save flow, not Playwright's browser download event.
  const target = join(directory, fileName);
  const saved = app.evaluate(({ session }, target) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Native download timed out")), 20000);
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(target);
      item.once("done", (_event, state) => {
        clearTimeout(timeout);
        if (state === "completed") resolve(item.getFilename());
        else reject(new Error(`Download ${state}`));
      });
    });
  }), target);
  const [name] = await Promise.all([saved, page.getByRole("button", { name: buttonName, exact: true }).click()]);
  return { name, bytes: await readFile(target), target };
}

try {
  let page = await launch();
  assert.equal(await page.getByRole("button", { name: "ログイン", exact: true }).count(), 0);
  assert.equal(await page.locator(".month-task-chip").count(), 0);
  await page.getByRole("button", { name: "メンバー管理", exact: true }).click();
  for (const name of ["佐藤", "鈴木"]) {
    await page.getByLabel("新しいメンバー名").fill(name);
    await page.locator(".local-member-add").getByRole("button", { name: "メンバーを追加", exact: true }).click();
    await page.getByLabel(`${name}の名前`, { exact: true }).waitFor();
  }
  await page.screenshot({ path: join(artifacts, "members.png") });
  await page.getByRole("button", { name: "メンバー管理を閉じる", exact: true }).last().click();
  await createShift(page, "合同作業", ["佐藤", "鈴木"]);
  await createShift(page, "鈴木のみ", ["鈴木"]);
  await page.locator('.memo-image-add input[type="file"]').setInputFiles({
    name: "test.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7N0AAAAASUVORK5CYII=", "base64"),
  });
  await page.getByLabel("test.pngの画像名", { exact: true }).waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.sidebar-actions button:disabled'));

  await page.getByRole("button", { name: "メンバー管理", exact: true }).click();
  await page.getByLabel("佐藤の名前", { exact: true }).fill("佐藤太郎");
  await page.getByRole("button", { name: "佐藤の名前を保存", exact: true }).click();
  await page.getByLabel("佐藤太郎の名前", { exact: true }).waitFor();
  await page.getByRole("button", { name: "メンバー管理を閉じる", exact: true }).last().click();
  await page.getByRole("button", { name: "フィルター", exact: true }).click();
  await page.locator(".filter-popover").getByLabel("佐藤太郎", { exact: true }).check();
  await page.getByRole("button", { name: "フィルターを閉じる", exact: true }).click();
  assert.equal(await page.locator(".month-task-chip").count(), 1);
  await page.getByRole("button", { name: "フィルター", exact: true }).click();
  await page.locator(".filter-popover").getByLabel("佐藤太郎", { exact: true }).uncheck();
  await page.getByRole("button", { name: "フィルターを閉じる", exact: true }).click();
  await page.screenshot({ path: join(artifacts, "month.png") });

  for (const view of ["週", "日", "月"]) {
    await page.locator(".segmented-control").getByRole("button", { name: view, exact: true }).click();
    await page.screenshot({ path: join(artifacts, `${view === "週" ? "week" : view === "日" ? "day" : "month"}.png`) });
  }
  await page.getByRole("button", { name: "設定", exact: true }).first().click();
  await page.getByRole("button", { name: "画像出力を開く", exact: true }).click();
  const pngDownload = await download(page, "PNGを保存", "calendar.png");
  const png = pngDownload.bytes;
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
  await copyFile(pngDownload.target, join(artifacts, "calendar.png"));
  const nonWhite = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 220) count++;
    return count;
  }, png.toString("base64"));
  assert.ok(nonWhite > 1000, "export must contain visible calendar content");
  await page.getByLabel("出力対象", { exact: true }).selectOption("members");
  const zipDownload = await download(page, "ZIPを保存", "members.zip");
  const zip = await JSZip.loadAsync(zipDownload.bytes);
  const names = Object.keys(zip.files);
  assert.equal(names.length, 2);
  assert.ok(names.some((name) => name.includes("佐藤太郎")));
  assert.ok(names.some((name) => name.includes("鈴木")));
  await copyFile(zipDownload.target, join(artifacts, "members.zip"));
  await app.close(); app = undefined;
  page = await launch();
  await page.locator(".month-task-chip").filter({ hasText: "合同作業" }).waitFor();
  assert.equal(await page.locator(".month-task-chip").count(), 2);
  await page.locator(".month-task-chip").filter({ hasText: "鈴木のみ" }).click();
  await page.waitForFunction(() => {
    const image = document.querySelector('.memo-image-preview-button img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  await page.getByRole("button", { name: "メンバー管理", exact: true }).click();
  for (let index = 0; index < 20; index++) {
    const name = `TestMember${index}`;
    await page.getByLabel("新しいメンバー名").fill(name);
    await page.locator(".local-member-add").getByRole("button", { name: "メンバーを追加", exact: true }).click();
    await page.getByLabel(`${name}の名前`, { exact: true }).waitFor();
  }
  for (const viewport of [{ width: 1280, height: 800 }, { width: 980, height: 680 }, { width: 390, height: 720 }]) {
    await app.evaluate(({ BrowserWindow }, viewport) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(320, 400);
      window.setContentSize(viewport.width, viewport.height);
    }, viewport);
    await page.waitForFunction((width) => innerWidth === width, viewport.width);
    await page.getByRole("button", { name: "TestMember19を削除", exact: true }).click();
    const confirmation = page.getByLabel("削除確認", { exact: true });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "削除確認");
    const reachable = await confirmation.evaluate((input) => {
      const rect = input.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
        && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
    });
    assert.ok(reachable, `deletion confirmation must be reachable without scrolling at ${viewport.width}px`);
    await page.keyboard.type("INVALID");
    assert.ok(await page.locator(".local-member-delete").getByRole("button", { name: "削除", exact: true }).isDisabled());
    await confirmation.press("Enter");
    assert.equal(await page.getByLabel("TestMember19の名前", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    assert.equal(await confirmation.count(), 0);
  }
  await page.getByRole("button", { name: "TestMember19を削除", exact: true }).click();
  await page.keyboard.type("DELETE");
  await page.locator(".local-member-delete").getByRole("button", { name: "削除", exact: true }).click();
  await page.getByLabel("TestMember19の名前", { exact: true }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "TestMember18を削除", exact: true }).click();
  await page.keyboard.type("TestMember18");
  await page.getByLabel("削除確認", { exact: true }).press("Enter");
  await page.getByLabel("TestMember18の名前", { exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS: no login, multiple members, assignment, rename, filter, month/week/day, FHD PNG, per-member ZIP, image attachment, restart, deletion focus/visibility at desktop and mobile widths, confirmation validation and cancel");
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: join(artifacts, "failure.png") });
    console.error((await lastPage.locator("body").innerText()).slice(-4000));
  }
  throw error;
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
