import type { LaidOutSchedule, Schedule } from "../types";
import { durationToPercent, timeToMinutes, timeToPercent } from "./time";

type ScheduleWithRange = {
  schedule: Schedule;
  start: number;
  end: number;
};

export function layoutSchedulesForDay(
  schedules: Schedule[],
  maxVisibleColumns: number,
): LaidOutSchedule[] {
  const sorted = schedules
    .map((schedule) => ({
      schedule,
      start: timeToMinutes(schedule.startTime),
      end: Math.max(timeToMinutes(schedule.endTime), timeToMinutes(schedule.startTime) + 1),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const groups = createOverlapGroups(sorted);
  return groups.flatMap((group, groupIndex) => layoutGroup(group, groupIndex, maxVisibleColumns));
}

function createOverlapGroups(items: ScheduleWithRange[]): ScheduleWithRange[][] {
  const groups: ScheduleWithRange[][] = [];
  let currentGroup: ScheduleWithRange[] = [];
  let currentEnd = -1;

  for (const item of items) {
    if (currentGroup.length === 0 || item.start < currentEnd) {
      currentGroup.push(item);
      currentEnd = Math.max(currentEnd, item.end);
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
      currentEnd = item.end;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function layoutGroup(
  group: ScheduleWithRange[],
  groupIndex: number,
  maxVisibleColumns: number,
): LaidOutSchedule[] {
  const columnEnds: number[] = [];
  const assigned = group.map((item) => {
    let columnIndex = columnEnds.findIndex((end) => end <= item.start);
    if (columnIndex === -1) {
      columnIndex = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[columnIndex] = item.end;
    }

    return {
      item,
      columnIndex,
    };
  });

  const columnCount = Math.min(Math.max(columnEnds.length, 1), maxVisibleColumns);
  const groupId = `overlap-${groupIndex}`;

  return assigned.map(({ item, columnIndex }) => ({
    schedule: item.schedule,
    topPercent: timeToPercent(item.schedule.startTime),
    heightPercent: Math.max(durationToPercent(item.schedule.startTime, item.schedule.endTime), 1.8),
    columnIndex,
    columnCount,
    hidden: columnIndex >= maxVisibleColumns,
    groupId,
  }));
}
