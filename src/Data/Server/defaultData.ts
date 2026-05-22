import type { Database } from "./domain.ts";

export const defaultData: Database = {
  users: [],
  groups: [],
  joinRequests: [],
  sessions: [],
  schedules: [],
  trashSchedules: [],
  tags: [
    { id: "blue", name: "通常", color: "#3b82f6" },
    { id: "green", name: "確認", color: "#22c55e" },
    { id: "orange", name: "注意", color: "#f97316" },
    { id: "red", name: "重要", color: "#ef4444" },
    { id: "purple", name: "夜間", color: "#a855f7" },
    { id: "teal", name: "調査", color: "#14b8a6" },
  ],
};
