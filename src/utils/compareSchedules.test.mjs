import test from "node:test";
import assert from "node:assert/strict";
import { compareSchedules, projectScheduleComparison } from "./compareSchedules.ts";

const tags = [{ id: "tag", name: "通常", color: "#123456" }];
const task = (id, patch = {}) => ({ id, groupId: "local-workspace", siteName: id, content: "点検", date: "2026-11-15", endDate: "2026-11-15", startTime: "09:00", endTime: "10:00", members: ["山田", "田中"], memberIds: ["a", "b"], contractor: "会社", address: "住所", memo: "メモ", tagColor: "#123456", readBy: [], ...patch });
const base = (schedules) => ({ version: 1, id: "base", savedAt: "2026-11-15T00:00:00Z", schedules, tags });

test("no baseline is not an all-added comparison; empty baselines are valid", () => {
  assert.deepEqual(compareSchedules(null, [task("a")], tags), []);
  assert.deepEqual(compareSchedules(base([]), [task("a")], tags).map(c => c.kind), ["added"]);
});

test("compares by stable ID and ignores timestamps, read states, member/tag order and image URLs", () => {
  const original = task("a", { memoImages: [{ id: "image", name: "写真", url: "/old", createdAt: "old" }] });
  const current = { ...original, updatedAt: "new", readBy: ["確認済"], readByUserIds: ["a"], changeReadBy: ["a"], members: ["田中", "山田"], memberIds: ["b", "a"], tagColors: ["#123456"], memoImages: [{ id: "image", name: "写真", url: "/new", createdAt: "new" }] };
  assert.deepEqual(compareSchedules(base([original]), [current], tags), []);
  const changes = compareSchedules(base([original]), [{ ...current, siteName: "変更", memo: "新メモ", memoImages: [{ ...current.memoImages[0], name: "新しい名前" }] }], tags);
  assert.deepEqual(changes[0].fields.map(field => field.key), ["siteName", "memo", "memoImages"]);
  assert.equal(changes[0].fields[0].before, "a");
  assert.equal(changes[0].fields[0].after, "変更");
});

test("add/modify/delete and reverting/restoring tasks have the expected net differences", () => {
  const baseline = base([task("a"), task("b")]);
  const changes = compareSchedules(baseline, [task("a", { content: "変更後" }), task("c")], tags);
  assert.deepEqual(changes.map(change => [change.id, change.kind]), [["a", "modified"], ["b", "deleted"], ["c", "added"]]);
  assert.deepEqual(compareSchedules(baseline, [task("b"), task("a")], tags), []);
  assert.equal(compareSchedules(baseline, [task("a", { endDate: undefined }), task("b")], tags).length, 0);
});

test("tag names, assignments and attachment identity are meaningful changes", () => {
  const old = task("a", { memoImages: [{ id: "one", name: "同名", createdAt: "" }] });
  const changes = compareSchedules(base([old]), [{ ...old, memberIds: ["other"], memoImages: [{ id: "two", name: "同名", createdAt: "" }] }], [{ ...tags[0], name: "変更したタグ" }]);
  assert.deepEqual(changes[0].fields.map(field => field.key), ["memberIds", "memoImages", "tags"]);
});

test("projection retains removed tasks and old time positions with unique read-only presentation IDs", () => {
  const before = [task("move"), task("delete"), task("same")];
  const after = [task("move", { date: "2026-11-16", endDate: "2026-11-16" }), task("same")];
  const changes = compareSchedules(base(before), after, tags);
  const view = projectScheduleComparison(after, changes, base(before).savedAt, new Set(before.map(s => s.id)));
  assert.equal(view.schedules.length, 4);
  assert.equal(new Set(view.schedules.map(s => s.id)).size, 4);
  assert.equal(view.comparison.marks.move.kind, "modified");
  assert.equal(view.comparison.marks["comparison-before-move"].label, "変更前");
  assert.equal(view.comparison.marks["comparison-before-delete"].readonly, true);
  assert.equal(view.comparison.marks["comparison-before-delete"].sourceId, "delete");
  assert.equal(view.comparison.marks.same, undefined);
  assert.equal(before[0].id, "move");
});

test("member exports retain an assignment that was removed and do not leak unselected members' tasks", () => {
  const before = [task("changed"), task("unselected", { members: ["別の人"], memberIds: ["c"] })];
  const after = [task("changed", { members: ["田中"], memberIds: ["b"] }), before[1]];
  const changes = compareSchedules(base(before), after, tags);
  const view = projectScheduleComparison([], changes, base(before).savedAt, new Set(["changed"]));
  assert.equal(view.schedules.length, 1);
  assert.equal(view.schedules[0].siteName, "changed");
  assert.equal(view.comparison.marks[view.schedules[0].id].label, "変更前");
  assert.equal(view.comparison.marks[view.schedules[0].id].readonly, true);
});
