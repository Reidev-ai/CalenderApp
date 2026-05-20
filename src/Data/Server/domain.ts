import type { Schedule, Tag, UserRole } from "../../types.ts";

export type ServerUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  groupId: string;
  pending: boolean;
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
};

export type Session = {
  token: string;
  userId: string;
  createdAt: string;
};

export type Database = {
  users: ServerUser[];
  groups: Group[];
  joinRequests: JoinRequest[];
  sessions: Session[];
  schedules: Schedule[];
  trashSchedules: Schedule[];
  tags: Tag[];
};

export type PublicUser = Omit<ServerUser, "passwordHash">;

export type RegisterBody = {
  email?: string;
  password?: string;
  name?: string;
  groupName?: string;
  groupId?: string;
};

export type LoginBody = {
  email?: string;
  password?: string;
};

export type SchedulePatch = Partial<Schedule>;
