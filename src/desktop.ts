import type { AuthSession } from "./types.js";
import type { UpdateStatus } from "./updateTypes.js";

export type DesktopRequest = { method: string; path: string; body?: unknown };
export type DesktopResponse = { ok: true; data: unknown } | { ok: false; error: string };
declare global {
  interface Window {
    calendarDesktop?: {
      request: (request: DesktopRequest) => Promise<DesktopResponse>;
      updates: {
        getStatus: () => Promise<UpdateStatus>;
        download: () => Promise<UpdateStatus>;
        install: () => Promise<UpdateStatus>;
        subscribe: (listener: (status: UpdateStatus) => void) => () => void;
      };
    };
  }
}
export const isDesktopApp = typeof window !== "undefined" && Boolean(window.calendarDesktop);
// Internal editing context only. There is no account or authentication token.
export const localSession: AuthSession = {
  token: "",
  user: { id: "local-operator", name: "シフト管理", email: "", role: "Admin", groupId: "local-workspace", pending: false },
};
export async function requestDesktop<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!window.calendarDesktop) throw new Error("デスクトップの保存機能に接続できません");
  const response = await window.calendarDesktop.request({ method, path, body });
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}
