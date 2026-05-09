export type Schedule = {
  id: string;
  siteName: string;
  content: string;
  date: string;
  startTime: string;
  endTime: string;
  members: string[];
  contractor: string;
  address: string;
  memo: string;
  tagColor: string;
};

export type SidebarMode = "edit" | "detail" | "overlapList";

export type LaidOutSchedule = {
  schedule: Schedule;
  topPercent: number;
  heightPercent: number;
  columnIndex: number;
  columnCount: number;
  hidden: boolean;
  groupId: string;
};
