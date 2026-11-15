import type { Schedule, Tag } from "../types";
import type { CalendarComparison, ScheduleBaseline, ScheduleChange, ScheduleFieldChange } from "../comparisonTypes";

const labels = { added: "追加", modified: "変更", deleted: "削除" };
const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

function values(schedule: Schedule, tags: Tag[]) {
  const colors = uniqueSorted(schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor].filter(Boolean));
  return {
    siteName: schedule.siteName, content: schedule.content,
    date: schedule.date, endDate: schedule.endDate ?? schedule.date,
    startTime: schedule.startTime, endTime: schedule.endTime,
    members: uniqueSorted(schedule.members).join("、"),
    memberIds: uniqueSorted(schedule.memberIds ?? []).join(","),
    contractor: schedule.contractor, address: schedule.address, memo: schedule.memo,
    memoImages: (schedule.memoImages ?? []).map((image) => `${image.id}:${image.name}`).sort().join("\n"),
    tags: colors.map((color) => `${tags.find((tag) => tag.color.toLowerCase() === color.toLowerCase())?.name ?? color} (${color.toLowerCase()})`).join("、"),
  };
}
const fieldLabels: Record<keyof ReturnType<typeof values>, string> = {
  siteName: "現場名", content: "内容", date: "開始日", endDate: "終了日", startTime: "開始時間", endTime: "終了時間",
  members: "メンバー", memberIds: "メンバー割り当て", contractor: "元請業者", address: "住所", memo: "メモ", memoImages: "添付画像", tags: "タグ",
};

export function compareSchedules(baseline: ScheduleBaseline | null, schedules: Schedule[], tags: Tag[]): ScheduleChange[] {
  if (!baseline) return [];
  const previous = new Map(baseline.schedules.map((schedule) => [schedule.id, schedule]));
  const current = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const changes: ScheduleChange[] = [];
  for (const schedule of schedules) {
    const before = previous.get(schedule.id);
    if (!before) { changes.push({ id: schedule.id, kind: "added", after: schedule, fields: [] }); continue; }
    const beforeValues = values(before, baseline.tags);
    const afterValues = values(schedule, tags);
    const fields: ScheduleFieldChange[] = [];
    for (const key of Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]) {
      if (beforeValues[key] === afterValues[key]) continue;
      if (key === "memberIds" && beforeValues.members !== afterValues.members) continue;
      const format = (value: string, target: Schedule) => key === "memoImages" ? (target.memoImages ?? []).map((image) => image.name).join("、") : key === "memberIds" ? target.members.join("、") || "割り当てなし" : value;
      fields.push({ key, label: fieldLabels[key], before: format(beforeValues[key], before), after: format(afterValues[key], schedule) });
    }
    if (fields.length) changes.push({ id: schedule.id, kind: "modified", before, after: schedule, fields });
  }
  for (const before of baseline.schedules) if (!current.has(before.id)) changes.push({ id: before.id, kind: "deleted", before, fields: [] });
  return changes.sort((a, b) => {
    const left = a.after ?? a.before!;
    const right = b.after ?? b.before!;
    return left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.siteName.localeCompare(right.siteName, "ja") || a.id.localeCompare(b.id);
  });
}

export function projectScheduleComparison(current: Schedule[], changes: ScheduleChange[], savedAt: string, visibleBeforeIds: ReadonlySet<string>, name?: string) {
  const schedules = [...current];
  const currentIds = new Set(current.map((schedule) => schedule.id));
  const comparison: CalendarComparison = { savedAt, name, marks: {} };
  for (const change of changes) {
    if (currentIds.has(change.id)) comparison.marks[change.id] = { kind: change.kind, label: labels[change.kind], sourceId: change.id, fields: change.fields };
    if (!change.before || !visibleBeforeIds.has(change.id)) continue;
    const moved = change.fields.some((field) => ["date", "endDate", "startTime", "endTime"].includes(field.key));
    if (change.kind !== "deleted" && currentIds.has(change.id) && !moved) continue;
    // A distinct presentation ID keeps old positions read-only without changing
    // the real task ID used for persistence, selection or drag operations.
    const id = `comparison-before-${change.id}`;
    schedules.push({ ...change.before, id });
    comparison.marks[id] = { kind: "deleted", label: change.kind === "deleted" ? "削除" : "変更前", sourceId: change.id, readonly: true, fields: change.fields };
  }
  return { schedules, comparison };
}
