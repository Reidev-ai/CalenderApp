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
  tagColors?: string[];
  readBy: string[];
  isPersonal?: boolean;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type SidebarMode = "edit" | "detail" | "overlapList" | "trash";

export type CalendarViewMode = "month" | "week" | "day";

export type UserRole = "Admin" | "User" | "Guest";

export type TaskCellPriorityItem = {
  id: "time" | "siteName" | "members" | "contractor" | "address" | "memo";
  label: string;
};

export type LaidOutSchedule = {
  schedule: Schedule;
  topPercent: number;
  heightPercent: number;
  columnIndex: number;
  columnCount: number;
  hidden: boolean;
  groupId: string;
};
