export type Schedule = {
  id: string;
  groupId?: string;
  ownerUserId?: string;
  siteName: string;
  content: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  members: string[];
  contractor: string;
  address: string;
  memo: string;
  memoImages?: MemoImage[];
  tagColor: string;
  tagColors?: string[];
  readBy: string[];
  changeReadBy?: string[];
  isPersonal?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MemoImage = {
  id: string;
  name: string;
  type: string;
  dataUrl?: string;
  url?: string;
  createdAt: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type SidebarMode = "edit" | "detail" | "overlapList" | "trash";

export type CalendarViewMode = "month" | "week" | "day";

export type UserRole = "Admin" | "User" | "Guest";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groupId: string;
  pending: boolean;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type Group = {
  id: string;
  name: string;
  adminIds: string[];
  memberIds: string[];
};

export type JoinRequest = {
  id: string;
  groupId: string;
  userId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  user?: AuthUser;
  group?: Group;
};

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
