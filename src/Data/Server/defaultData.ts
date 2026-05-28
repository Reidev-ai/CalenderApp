import type { Database } from "./domain.ts";

export const defaultData: Database = {
  users: [],
  groups: [],
  joinRequests: [],
  sessions: [],
  schedules: [],
  trashSchedules: [],
  tags: [],
};
