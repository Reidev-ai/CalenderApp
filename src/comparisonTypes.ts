import type { Schedule, Tag } from "./types.js";

export type ScheduleChangeKind = "added" | "modified" | "deleted";
export type ScheduleBaseline = { version: 1; id: string; name?: string; savedAt: string; schedules: Schedule[]; tags: Tag[] };
export type BaselineHistory = { baselines: ScheduleBaseline[]; activeBaselineId: string | null };
export type ScheduleFieldChange = { key: string; label: string; before: string; after: string };
export type ScheduleChange = { id: string; kind: ScheduleChangeKind; before?: Schedule; after?: Schedule; fields: ScheduleFieldChange[] };
export type ComparisonMark = { kind: ScheduleChangeKind; label: string; sourceId: string; readonly?: boolean; fields: ScheduleFieldChange[] };
export type CalendarComparison = { savedAt: string; name?: string; marks: Record<string, ComparisonMark> };
