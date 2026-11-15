import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const require = createRequire(`${root}/package.json`);
const { _electron } = require("playwright");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const data = await mkdtemp(join(tmpdir(), "calender-comparison-data-"));
const artifacts = await mkdtemp(join(tmpdir(), "calender-comparison-output-"));
const env = { ...process.env, CALENDAR_DESKTOP_TEST_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const errors = [];
let app, page;

async function request(method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const result = await window.calendarDesktop.request({ method, path, body });
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, { method, path, body });
}
async function openComparison() { await page.getByRole("button", { name: "状態と差分を開く", exact: true }).click(); }
async function closeComparison() { await page.getByRole("button", { name: "差分パネルを閉じる", exact: true }).click(); }
async function ready() { await page.waitForFunction(() => document.querySelector('.export-preview[aria-busy="false"]') && !document.querySelector(".capture-panel-actions .primary-button").disabled); }
async function download(buttonName, fileName) {
  await ready();
  const path = join(artifacts, fileName);
  const saved = app.evaluate(({ session }, path) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Download timed out")), 30000);
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(path);
      item.once("done", (_event, state) => { clearTimeout(timer); state === "completed" ? resolve(item.getFilename()) : reject(Error(state)); });
    });
  }), path);
  await Promise.all([saved, page.getByRole("button", { name: buttonName, exact: true }).click()]);
  return path;
}
async function readWorkbook(path) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(path)); return workbook; }
function sites(workbook) {
  return workbook.worksheets.flatMap(sheet => {
    const result = [];
    sheet.eachRow(row => { if (row.getCell(2).value === "現場名" && row.getCell(3).value) result.push({ value: row.getCell(3).value, fill: row.getCell(3).fill, row, sheet }); });
    return result;
  });
}

try {
  app = await _electron.launch({ executablePath: require("electron"), args: [root], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.getByRole("button", { name: "状態と差分を開く", exact: true }).waitFor();
  assert.match(page.url(), /\/dist\/index\.html$/);
  assert.equal(await page.title(), "Calender UI");
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const date = day => `${prefix}-${String(day).padStart(2, "0")}`;
  const { user: a } = await request("POST", "/api/groups/local-workspace/members", { name: "山田" });
  const { user: b } = await request("POST", "/api/groups/local-workspace/members", { name: "田中" });
  const create = async (siteName, day, startTime, patch = {}) => (await request("POST", "/api/schedules", { siteName, date: date(day), endDate: date(day), startTime, endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, "0")}:00`, content: "変更前の内容", contractor: "サンプル会社", address: "東京都", memo: "", members: [a.name], memberIds: [a.id], tagColor: "#3b82f6", ...patch })).schedule;
  const original = await create("変更前の予定", 10, "04:00");
  const deleted = await create("削除する予定", 10, "08:00");
  const moved = await create("移動する予定", 10, "12:00");
  const assignment = await create("割り当て予定", 14, "10:00");
  const unchanged = await create("変更しない予定", 13, "10:00");
  await page.reload();
  await openComparison();
  await page.getByLabel("新しい保存状態の名前", { exact: true }).fill("初回配布");
  await page.getByRole("button", { name: "状態を保存", exact: true }).click();
  await page.getByText("保存時点からの変更はありません。", { exact: true }).waitFor();
  const { baseline } = await request("GET", "/api/baseline");
  assert.equal(baseline.schedules.length, 5);
  await closeComparison();

  await request("PUT", `/api/schedules/${original.id}`, { ...original, siteName: "変更済みの予定", content: "変更後の内容" });
  await request("DELETE", `/api/schedules/${deleted.id}`);
  await request("PUT", `/api/schedules/${moved.id}`, { ...moved, date: date(11), endDate: date(11) });
  await request("PUT", `/api/schedules/${assignment.id}`, { ...assignment, members: [b.name], memberIds: [b.id] });
  await create("追加した予定", 12, "16:00");
  await page.reload();
  await openComparison();
  await page.getByRole("option", { name: "すべて（5）", exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.locator(".comparison-change").count(), 5);
  assert.equal(await page.locator(".comparison-before").getByText("変更前の内容", { exact: true }).count(), 1);
  assert.equal(await page.locator(".comparison-after").getByText("変更後の内容", { exact: true }).count(), 1);
  await page.getByLabel("差分の種類", { exact: true }).selectOption("modified");
  assert.equal(await page.locator(".comparison-change").count(), 3);
  await page.getByLabel("差分の種類", { exact: true }).selectOption("all");
  await page.getByLabel("新しい保存状態の名前", { exact: true }).fill("修正版");
  await page.getByRole("button", { name: "状態を保存", exact: true }).click();
  await page.getByText("保存時点からの変更はありません。", { exact: true }).waitFor();
  const second = await request("GET", "/api/baselines");
  assert.equal(second.baselines.length, 2);
  assert.notEqual(second.activeBaselineId, baseline.id);
  await page.getByLabel("比較する保存状態", { exact: true }).selectOption(baseline.id);
  await page.getByRole("option", { name: "すべて（5）", exact: true }).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "保存状態の名前を変更", exact: true }).click();
  await page.getByLabel("保存状態の名前", { exact: true }).fill("初回配布（確定）");
  await page.getByRole("button", { name: "保存状態の名前を保存", exact: true }).click();
  await page.getByLabel("保存状態の名前", { exact: true }).waitFor({ state: "detached" });
  assert.ok(await page.locator(".comparison-panel").evaluate(panel => panel.contains(document.activeElement)));
  await page.screenshot({ path: join(artifacts, "difference-list.png") });
  await page.getByLabel("差分を色で表示", { exact: true }).uncheck();
  await closeComparison();
  assert.equal(await page.locator(".calendar-panel [data-comparison]").count(), 0);
  await page.reload();
  await openComparison();
  assert.equal(await page.getByLabel("比較する保存状態", { exact: true }).inputValue(), baseline.id);
  assert.equal(await page.getByLabel("差分を色で表示", { exact: true }).isChecked(), false);
  await page.getByLabel("差分を色で表示", { exact: true }).check();
  await closeComparison();
  for (const kind of ["added", "modified", "deleted"]) assert.ok(await page.locator(`.calendar-panel [data-comparison="${kind}"]`).count() > 0);
  await page.screenshot({ path: join(artifacts, "calendar-month.png") });
  await page.locator(`.month-task-chip[data-schedule-id="${unchanged.id}"]`).click();
  await page.getByLabel("現場名", { exact: true }).fill("未保存の編集");
  await openComparison();
  assert.ok(await page.getByRole("button", { name: "状態を保存", exact: true }).isDisabled());
  assert.equal((await request("GET", "/api/baseline")).baseline.id, baseline.id);
  await closeComparison();
  assert.equal(await page.getByLabel("現場名", { exact: true }).inputValue(), "未保存の編集");
  await page.locator(".sidebar-actions").getByRole("button", { name: "キャンセル", exact: true }).click();
  const deletedCard = page.locator(`.month-day-cell[data-date-key="${date(10)}"] .month-task-chip[title="削除: 削除する予定"]`);
  await deletedCard.focus(); await deletedCard.press("Enter");
  assert.equal(await page.locator(".comparison-change.is-focused").getAttribute("data-change-id"), deleted.id);
  await closeComparison();
  await page.locator(`.month-day-cell[data-date-key="${date(10)}"] .month-date-pill`).click();
  await page.locator(".segmented-control").getByRole("button", { name: "週", exact: true }).click();
  for (const kind of ["modified", "deleted"]) assert.ok(await page.locator(`.calendar-panel .task-cell[data-comparison="${kind}"]`).count() > 0);
  assert.equal(await page.locator('.calendar-panel .task-cell[data-comparison="added"]').count() > 0, await page.locator(`.day-column[data-date-key="${date(12)}"]`).count() > 0);
  await page.screenshot({ path: join(artifacts, "calendar-week.png") });
  await page.locator(".segmented-control").getByRole("button", { name: "日", exact: true }).click();
  assert.ok(await page.locator('.calendar-panel .task-cell[data-comparison="deleted"]').count() > 0);
  assert.ok(await page.locator('.calendar-panel .task-cell[data-comparison="modified"]').count() > 0);
  await page.locator(".segmented-control").getByRole("button", { name: "月", exact: true }).click();

  await page.getByRole("button", { name: "設定", exact: true }).first().click();
  await page.getByRole("button", { name: "画像出力を開く", exact: true }).click();
  await page.getByLabel("出力形式", { exact: true }).selectOption("xlsx");
  const workbook = await readWorkbook(await download("Excelを保存", "comparison.xlsx"));
  assert.equal(workbook.worksheets.length, 3);
  const entries = sites(workbook);
  assert.equal(entries.length, 7);
  assert.ok(entries.some(entry => entry.value === "【追加】追加した予定" && entry.fill.fgColor.argb === "FFDCFCE7"));
  assert.ok(entries.some(entry => entry.value === "【変更】変更済みの予定" && entry.fill.fgColor.argb === "FFFDE68A"));
  assert.ok(entries.some(entry => entry.value === "【削除】削除する予定" && entry.fill.fgColor.argb === "FFFEE2E2"));
  assert.ok(entries.some(entry => entry.value === "【変更前】移動する予定" && entry.row.getCell(3).font.strike));
  assert.match(workbook.worksheets[0].getCell("A2").text, /緑:追加/);
  assert.match(workbook.worksheets[0].getCell("A2").text, /初回配布（確定）/);
  await page.getByRole("tab").nth(1).click();
  assert.ok(await page.locator('.export-sheet-table td[style*="rgb(220, 252, 231)"]').count() > 0);
  await page.getByRole("tab").first().click();
  await page.locator(".export-sheet-table td").getByText("【変更】変更済みの予定", { exact: true }).scrollIntoViewIfNeeded();
  for (const size of [{ width: 1280, height: 840 }, { width: 980, height: 680 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(size); await ready();
    await page.screenshot({ path: join(artifacts, `excel-${size.width}.png`) });
    const bounds = await page.getByRole("button", { name: "Excelを保存", exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.getByLabel("出力対象", { exact: true }).selectOption("members");
  await page.locator(".capture-member-list").getByLabel(b.name, { exact: true }).uncheck();
  const memberWorkbook = await readWorkbook(await download("Excelを保存", "member-comparison.xlsx"));
  const removedAssignment = sites(memberWorkbook).find(entry => entry.value === "【変更前】割り当て予定");
  assert.ok(removedAssignment);
  assert.equal(removedAssignment.sheet.getCell(removedAssignment.row.number + 2, 7).text, a.name);
  await page.getByLabel("出力対象", { exact: true }).selectOption("current");
  await page.getByLabel("差分を色分けして出力", { exact: true }).uncheck();
  const plain = await readWorkbook(await download("Excelを保存", "without-comparison.xlsx"));
  assert.equal(sites(plain).length, 5);
  assert.ok(!sites(plain).some(entry => /【(?:追加|変更|削除)/.test(entry.value)));
  await page.getByLabel("差分を色分けして出力", { exact: true }).check();
  await page.getByLabel("出力形式", { exact: true }).selectOption("png"); await ready();
  const preview = page.getByAltText("カレンダー出力プレビュー");
  const info = await preview.evaluate(async image => {
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = [0, 0, 0]; const colors = [[220, 252, 231], [254, 249, 195], [254, 226, 226]];
    for (let index = 0; index < pixels.length; index += 4) colors.forEach((color, k) => { if (color.every((part, offset) => part === pixels[index + offset])) counts[k]++; });
    return { counts, width: image.naturalWidth, height: image.naturalHeight, src: image.src };
  });
  assert.equal(info.width, 1920); assert.equal(info.height, 1080); assert.ok(info.counts.every(count => count > 100));
  const imagePath = await download("PNGを保存", "comparison.png");
  assert.deepEqual(await readFile(imagePath), Buffer.from(info.src.split(",")[1], "base64"));
  await page.screenshot({ path: join(artifacts, "image-preview.png") });
  await page.getByLabel("出力対象", { exact: true }).selectOption("members");
  await page.getByRole("button", { name: "全員", exact: true }).click(); await ready();
  const zip = await JSZip.loadAsync(await readFile(await download("ZIPを保存", "comparison-members.zip")));
  assert.equal(Object.keys(zip.files).length, 2);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.locator(".setting-drawer.open .drawer-header .icon-button").click();
  await openComparison();
  for (const size of [{ width: 1280, height: 840 }, { width: 980, height: 680 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(size);
    const bounds = await page.getByRole("button", { name: "状態を保存", exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height);
    assert.ok(await page.locator(".comparison-change-list").evaluate(list => list.clientHeight > 100));
    await page.screenshot({ path: join(artifacts, `differences-${size.width}.png`) });
  }
  await closeComparison();
  const mobileButton = await page.getByRole("button", { name: "状態と差分を開く", exact: true }).boundingBox();
  assert.ok(mobileButton.x >= 0 && mobileButton.x + mobileButton.width <= 390);
  await page.screenshot({ path: join(artifacts, "calendar-mobile.png") });
  assert.ok(await page.locator('.overlap-item[data-comparison="deleted"]').count() > 0);
  await page.setViewportSize({ width: 1280, height: 840 });
  await openComparison();
  await page.getByRole("button", { name: "選択した保存状態を削除", exact: true }).click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  assert.equal((await request("GET", "/api/baselines")).baselines.length, 2);
  await page.getByRole("button", { name: "選択した保存状態を削除", exact: true }).click();
  await page.getByRole("button", { name: "この保存状態を削除", exact: true }).click();
  await page.getByText("保存時点からの変更はありません。", { exact: true }).waitFor();
  assert.equal((await request("GET", "/api/baseline")).baseline.id, second.activeBaselineId);
  assert.equal((await request("GET", "/api/schedules")).schedules.length, 5);
  await page.getByRole("button", { name: "選択した保存状態を削除", exact: true }).click();
  await page.getByRole("button", { name: "この保存状態を削除", exact: true }).click();
  await page.getByText("まだ状態を保存していません。", { exact: true }).waitFor();
  assert.ok(await page.locator(".comparison-panel").evaluate(panel => panel.contains(document.activeElement)));
  assert.equal((await request("GET", "/api/baselines")).baselines.length, 0);
  assert.equal((await request("GET", "/api/schedules")).schedules.length, 5);
  assert.deepEqual(errors, []);
  console.log("Artifacts:", artifacts);
  console.log("PASS: multiple named snapshots, switching/restoring selection, rename, confirmed deletion/cancel/fallback/last item, per-field diff, all calendar views, read-only cards, 3-sheet colored Excel with selected snapshot name, FHD PNG + ZIP, responsive layout, console health");
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(artifacts, "failure.png") }); console.error((await page.locator("body").innerText()).slice(-2500)); }
  console.error("Artifacts:", artifacts);
  throw error;
} finally { await app?.close(); await rm(data, { recursive: true, force: true }); }
