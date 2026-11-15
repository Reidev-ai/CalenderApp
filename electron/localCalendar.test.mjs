import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalCalendar } from "../dist-electron/electron/localCalendar.js";
import initSqlJs from "sql.js";

const wasm = resolve("node_modules/sql.js/dist/sql-wasm.wasm");
const memberPath = "/api/groups/local-workspace/members";
const shift = { siteName: "現場A", date: "2026-10-09", endDate: "2026-10-10", startTime: "23:00", endTime: "02:00", members: [], memberIds: [] };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "calender-local-test-"));
  let store = await LocalCalendar.open(directory, wasm);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    directory,
    request: (method, path, body) => store.request({ method, path, body }),
    restart: async () => { await store.close(); store = await LocalCalendar.open(directory, wasm); },
    backup: () => store.backupBeforeUpdate(),
  };
}

test("empty installation needs no login and persists multiple members and shifts", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request("GET", "/api/schedules")).schedules, []);
  assert.deepEqual((await f.request("GET", memberPath)).users, []);
  const [{ user: a }, { user: b }] = await Promise.all([
    f.request("POST", memberPath, { name: "佐藤" }), f.request("POST", memberPath, { name: "鈴木" }),
  ]);
  assert.notEqual(a.id, b.id);
  const { schedule } = await f.request("POST", "/api/schedules", { ...shift, members: [a.name, b.name], memberIds: [a.id, b.id], groupId: "other" });
  assert.equal(schedule.groupId, "local-workspace");
  assert.equal(schedule.endDate, "2026-10-10");
  await f.restart();
  assert.equal((await f.request("GET", memberPath)).users.length, 2);
  assert.deepEqual((await f.request("GET", "/api/schedules")).schedules[0].memberIds, [a.id, b.id]);
  assert.equal((await readFile(join(f.directory, "calendar.sqlite"))).subarray(0, 15).toString(), "SQLite format 3");
});

test("baseline captures durable tasks atomically, ignores supplied snapshot data and survives restart", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("GET", "/api/baseline")).baseline, null);
  const pending = f.request("POST", "/api/schedules", shift);
  const saving = f.request("POST", "/api/baseline", { expectedId: null, schedules: [] });
  const { schedule } = await pending;
  const { baseline } = await saving;
  assert.equal(baseline.schedules.length, 1);
  assert.equal(baseline.schedules[0].id, schedule.id);
  assert.equal(baseline.version, 1);
  assert.ok(Number.isFinite(Date.parse(baseline.savedAt)));
  await f.request("PUT", `/api/schedules/${schedule.id}`, { ...schedule, siteName: "変更後" });
  await f.request("DELETE", `/api/schedules/${schedule.id}`);
  await f.restart();
  const saved = (await f.request("GET", "/api/baseline")).baseline;
  assert.equal(saved.schedules[0].siteName, shift.siteName);
  assert.equal(saved.id, baseline.id);
  saved.schedules[0].siteName = "応答の改変";
  assert.equal((await f.request("GET", "/api/baseline")).baseline.schedules[0].siteName, shift.siteName);
  await assert.rejects(f.request("POST", "/api/baseline", { expectedId: null }), /比較基準が更新/);
  const { baseline: replaced } = await f.request("POST", "/api/baseline", { expectedId: baseline.id });
  assert.notEqual(replaced.id, baseline.id);
  assert.deepEqual(replaced.schedules, []);
  assert.equal((await f.request("GET", "/api/baselines")).baselines.length, 2);
});

test("multiple snapshots can be selected, renamed and deleted without changing schedules", async (t) => {
  const f = await fixture(t);
  const { schedule } = await f.request("POST", "/api/schedules", shift);
  const first = await f.request("POST", "/api/baselines", { name: "初回配布" });
  const firstId = first.activeBaselineId;
  await f.request("PUT", `/api/schedules/${schedule.id}`, { ...schedule, siteName: "修正後" });
  const second = await f.request("POST", "/api/baselines", { name: "修正版" });
  const secondId = second.activeBaselineId;
  assert.deepEqual(second.baselines.map(item => item.name), ["修正版", "初回配布"]);
  assert.equal(second.baselines[1].schedules[0].siteName, shift.siteName);
  await f.request("PATCH", "/api/baseline", { id: firstId });
  await f.restart();
  assert.equal((await f.request("GET", "/api/baselines")).activeBaselineId, firstId);
  assert.equal((await f.request("GET", "/api/baseline")).baseline.id, firstId);
  await assert.rejects(f.request("PATCH", "/api/baseline", { id: "missing" }));
  await assert.rejects(f.request("POST", "/api/baselines", { name: "a".repeat(101) }));
  await assert.rejects(f.request("PATCH", `/api/baselines/${firstId}`, { name: null }));
  const renamed = await f.request("PATCH", `/api/baselines/${firstId}`, { name: " 当初の予定 " });
  assert.equal(renamed.baselines.find(item => item.id === firstId).name, "当初の予定");
  assert.equal(renamed.baselines.find(item => item.id === firstId).savedAt, first.baselines[0].savedAt);
  await assert.rejects(f.request("DELETE", `/api/baselines/${firstId}`), /確認/);
  await f.request("DELETE", `/api/baselines/${secondId}`, { confirmId: secondId });
  assert.equal((await f.request("GET", "/api/baselines")).activeBaselineId, firstId);
  const last = await f.request("DELETE", `/api/baselines/${firstId}`, { confirmId: firstId });
  assert.deepEqual(last, { baselines: [], activeBaselineId: null });
  assert.equal((await f.request("GET", "/api/schedules")).schedules[0].siteName, "修正後");
  await f.restart();
  assert.equal((await f.request("GET", "/api/baseline")).baseline, null);
});

test("legacy single snapshot migrates with its original ID, time and contents", async (t) => {
  const f = await fixture(t);
  await f.request("POST", "/api/schedules", shift);
  const created = await f.request("POST", "/api/baselines", {});
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const db = new SQL.Database(await readFile(join(f.directory, "calendar.sqlite")));
  const state = JSON.parse(String(db.exec("SELECT payload FROM calendar_state WHERE id = 1")[0].values[0][0]));
  state.baseline = state.baselines[0];
  delete state.baselines; delete state.activeBaselineId;
  db.run("UPDATE calendar_state SET payload = ? WHERE id = 1", [JSON.stringify(state)]);
  await writeFile(join(f.directory, "calendar.sqlite"), db.export()); db.close();
  await f.restart();
  const history = await f.request("GET", "/api/baselines");
  assert.deepEqual(history.baselines, JSON.parse(JSON.stringify(created.baselines)));
  assert.equal(history.activeBaselineId, created.activeBaselineId);
  await f.request("POST", "/api/baselines", { name: "移行後の追加" });
  await f.restart();
  assert.equal((await f.request("GET", "/api/baselines")).baselines.length, 2);
});

test("failed snapshot selection, rename and deletion preserve the complete history", async (t) => {
  const f = await fixture(t);
  const first = await f.request("POST", "/api/baselines", { name: "一つ目" });
  const initial = await f.request("POST", "/api/baselines", { name: "二つ目" });
  await mkdir(join(f.directory, "calendar.sqlite.tmp"));
  await assert.rejects(f.request("PATCH", "/api/baseline", { id: first.activeBaselineId }));
  await assert.rejects(f.request("PATCH", `/api/baselines/${first.activeBaselineId}`, { name: "保存失敗" }));
  await assert.rejects(f.request("DELETE", `/api/baselines/${initial.activeBaselineId}`, { confirmId: initial.activeBaselineId }));
  assert.deepEqual(await f.request("GET", "/api/baselines"), { baselines: initial.baselines, activeBaselineId: initial.activeBaselineId });
  await rm(join(f.directory, "calendar.sqlite.tmp"), { recursive: true });
  await f.restart();
  assert.equal((await f.request("GET", "/api/baselines")).baselines.length, 2);
  const removed = await f.request("DELETE", `/api/baselines/${initial.activeBaselineId}`, { confirmId: initial.activeBaselineId });
  assert.equal(removed.activeBaselineId, first.activeBaselineId);
});

test("baseline write failure retains the previous baseline and retries safely", async (t) => {
  const f = await fixture(t);
  const { baseline } = await f.request("POST", "/api/baseline", { expectedId: null });
  await f.request("POST", "/api/schedules", shift);
  await mkdir(join(f.directory, "calendar.sqlite.tmp"));
  await assert.rejects(f.request("POST", "/api/baseline", { expectedId: baseline.id }));
  assert.equal((await f.request("GET", "/api/baseline")).baseline.id, baseline.id);
  await rm(join(f.directory, "calendar.sqlite.tmp"), { recursive: true });
  await f.restart();
  assert.equal((await f.request("GET", "/api/baseline")).baseline.schedules.length, 0);
  const updated = await f.request("POST", "/api/baseline", { expectedId: baseline.id });
  assert.equal(updated.baseline.schedules.length, 1);
});

test("rename retains member ID and updates assigned names; deleting member retains shifts", async (t) => {
  const f = await fixture(t);
  const { user } = await f.request("POST", memberPath, { name: "田中" });
  const { schedule } = await f.request("POST", "/api/schedules", { ...shift, members: [user.name], memberIds: [user.id] });
  await f.request("PATCH", `${memberPath}/${user.id}`, { name: "田中太郎" });
  assert.deepEqual((await f.request("GET", "/api/schedules")).schedules[0].members, ["田中太郎"]);
  await f.request("DELETE", `/api/schedules/${schedule.id}`);
  assert.equal((await f.request("GET", "/api/schedules")).schedules.length, 0);
  await f.restart();
  assert.equal((await f.request("GET", "/api/schedules")).schedules.length, 0);
  await f.request("PATCH", `${memberPath}/${user.id}`, { name: "田中次郎" });
  await f.request("POST", `/api/trash/${schedule.id}/restore`);
  await f.request("DELETE", `${memberPath}/${user.id}`);
  assert.equal((await f.request("GET", memberPath)).users.length, 0);
  assert.deepEqual((await f.request("GET", "/api/schedules")).schedules[0].members, ["田中次郎"]);
});

test("images persist outside SQLite and can be reopened and renamed", async (t) => {
  const f = await fixture(t);
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7N0AAAAASUVORK5CYII=";
  const { image } = await f.request("POST", "/api/memo-images", { name: "../photo.png", dataUrl });
  const { schedule } = await f.request("POST", "/api/schedules", { ...shift, memoImages: [{ ...image, name: "新しい名前.png" }] });
  await f.restart();
  assert.equal((await f.request("GET", image.url)).dataUrl, dataUrl);
  assert.equal((await f.request("GET", "/api/schedules")).schedules[0].memoImages[0].name, "新しい名前.png");
  await assert.rejects(f.request("PUT", `/api/schedules/${schedule.id}`, { ...schedule, memoImages: [{ id: "missing" }] }));
  await assert.rejects(f.request("POST", "/api/memo-images", { dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }));
});

test("write failure does not commit in memory or on restart and later writes recover", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, "calendar.sqlite.tmp"));
  await assert.rejects(f.request("POST", memberPath, { name: "保存失敗" }));
  assert.equal((await f.request("GET", memberPath)).users.length, 0);
  await rm(join(f.directory, "calendar.sqlite.tmp"), { recursive: true });
  await f.request("POST", memberPath, { name: "保存成功" });
  await f.restart();
  assert.deepEqual((await f.request("GET", memberPath)).users.map((user) => user.name), ["保存成功"]);
});

test("reject authentication, foreign workspace, traversal, duplicate people and invalid times", async (t) => {
  const f = await fixture(t);
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/groups/other/members", "/api/memo-images/../../secret", "https://example.com/api/schedules"]) {
    await assert.rejects(f.request("POST", path, {}));
  }
  await f.request("POST", memberPath, { name: "同名" });
  await assert.rejects(f.request("POST", memberPath, { name: "同名" }));
  await assert.rejects(f.request("POST", memberPath, { name: " " }));
  await assert.rejects(f.request("POST", "/api/schedules", { ...shift, startTime: "24:00" }));
  await assert.rejects(f.request("POST", "/api/schedules", { ...shift, date: "2026-02-30" }));
  await assert.rejects(f.request("POST", "/api/schedules", { ...shift, id: "../invalid" }));
  await assert.rejects(f.request("POST", "/api/schedules", { ...shift, members: "invalid" }));
  const log = await readFile(join(f.directory, "desktop.log"), "utf8");
  assert.ok(!log.includes("同名"));
});

test("tags and edits survive restart, and deleting a tag updates saved shifts", async (t) => {
  const f = await fixture(t);
  const { tag } = await f.request("POST", "/api/tags", { name: "特別", color: "#123456" });
  const { schedule } = await f.request("POST", "/api/schedules", { ...shift, tagColors: [tag.color] });
  await f.request("PUT", `/api/schedules/${schedule.id}`, { ...schedule, siteName: "現場B" });
  await f.request("PATCH", `/api/tags/${tag.id}`, { name: "名称変更" });
  await f.restart();
  assert.equal((await f.request("GET", "/api/schedules")).schedules[0].siteName, "現場B");
  assert.equal((await f.request("GET", "/api/tags")).tags.find((item) => item.id === tag.id).name, "名称変更");
  await f.request("DELETE", `/api/tags/${tag.id}`);
  assert.ok(!(await f.request("GET", "/api/schedules")).schedules[0].tagColors.includes(tag.color));
});

test("corrupt database is not replaced with an empty database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calender-corrupt-test-"));
  try {
    const bytes = Buffer.from("not a database");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "calendar.sqlite"), bytes);
    await assert.rejects(LocalCalendar.open(directory, wasm));
    assert.deepEqual(await readFile(join(directory, "calendar.sqlite")), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("pre-update backup waits for pending saves and retains their data", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.request("POST", memberPath, { name: "更新前" }), f.backup()]);
  assert.deepEqual(await readFile(join(f.directory, "calendar.sqlite")), await readFile(join(f.directory, "calendar.before-update.sqlite")));
});
