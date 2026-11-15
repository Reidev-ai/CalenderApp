import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import initSqlJs, { type Database as SqlDatabase } from "sql.js";
import type { AuthUser, MemoImage, Schedule } from "../src/types.js";
import type { DesktopRequest } from "../src/desktop.js";
import type { ScheduleBaseline } from "../src/comparisonTypes.js";
import type { Database } from "../src/Data/Server/domain.js";
import { createSchedule, updateSchedule, moveScheduleToTrash, restoreSchedule, listTags, createTag, updateTag, deleteTag } from "../src/Data/Server/services.js";

const groupId = "local-workspace";
const profile: AuthUser = { id: "local-operator", name: "シフト管理", email: "", role: "Admin", groupId, pending: false };
type State = { version: 1; members: AuthUser[]; images: MemoImage[]; data: Database; baselines: ScheduleBaseline[]; activeBaselineId: string | null; baseline?: ScheduleBaseline };

function validBaseline(value: ScheduleBaseline) {
  return value && value.version === 1 && typeof value.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value.id)
    && typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt))
    && Array.isArray(value.schedules) && Array.isArray(value.tags)
    && (value.name === undefined || (typeof value.name === "string" && value.name.length <= 100));
}

function baselineHistory(state: State) {
  return { baselines: state.baselines, activeBaselineId: state.activeBaselineId };
}

function baselineName(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length > 100) throw new Error("状態名は100文字以内で入力してください");
  return value.trim() || undefined;
}

export class LocalCalendar {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private directory: string, private db: SqlDatabase, private state: State) {}

  static async open(directory: string, wasmPath: string) {
    await mkdir(join(directory, "images"), { recursive: true });
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    let bytes: Buffer | undefined;
    try { bytes = await readFile(join(directory, "calendar.sqlite")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run("CREATE TABLE IF NOT EXISTS calendar_state (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)");
    const rows = db.exec("SELECT payload FROM calendar_state WHERE id = 1");
    const state: State = rows.length ? JSON.parse(String(rows[0].values[0][0])) : {
      version: 1, members: [], images: [], baselines: [], activeBaselineId: null,
      data: { users: [], groups: [], sessions: [], joinRequests: [], schedules: [], trashSchedules: [], tags: [] },
    };
    if (state.version !== 1 || !Array.isArray(state.members) || !Array.isArray(state.data?.schedules)) {
      db.close();
      throw new Error("対応していないデータ形式です。データを上書きせず起動を中止しました。");
    }
    if (state.baselines === undefined) state.baselines = [];
    if (!Array.isArray(state.baselines) || !state.baselines.every(validBaseline) ||
      new Set(state.baselines.map((item) => item.id)).size !== state.baselines.length || (state.baseline && !validBaseline(state.baseline))) {
      db.close();
      throw new Error("保存状態の形式が正しくありません。データを上書きせず起動を中止しました。");
    }
    // Preserve the old single snapshot, including files written by an older app.
    if (state.baseline && !state.baselines.some((item) => item.id === state.baseline!.id)) {
      state.baselines.unshift(state.baseline);
      state.activeBaselineId = state.baseline.id;
    }
    delete state.baseline;
    if (state.activeBaselineId === undefined) state.activeBaselineId = state.baselines[0]?.id ?? null;
    if ((state.activeBaselineId === null && state.baselines.length > 0) ||
      (state.activeBaselineId !== null && !state.baselines.some((item) => item.id === state.activeBaselineId))) {
      db.close();
      throw new Error("選択された比較基準が見つかりません。データを上書きせず起動を中止しました。");
    }
    listTags(state.data, groupId);
    const store = new LocalCalendar(directory, db, state);
    if (bytes) await copyFile(join(directory, "calendar.sqlite"), join(directory, "calendar.previous.sqlite"));
    else await store.persist(state);
    return store;
  }

  request(request: DesktopRequest): Promise<unknown> {
    const result = this.queue.then(async () => {
      try { return await this.dispatch(request); }
      catch (error) {
        await this.log("request_failed", request?.method, request?.path);
        throw error;
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close() { await this.queue; this.db.close(); }

  async backupBeforeUpdate() {
    const backup = this.queue.then(() => copyFile(join(this.directory, "calendar.sqlite"), join(this.directory, "calendar.before-update.sqlite")));
    this.queue = backup.catch(() => undefined);
    await backup;
  }

  private async dispatch(request: DesktopRequest): Promise<unknown> {
    if (!request || typeof request.path !== "string" || request.path.length > 512 ||
      !/^\/api\/[a-zA-Z0-9\-/]+$/.test(request.path) || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      throw new Error("許可されていない操作です");
    }
    const { method, path } = request;
    if (JSON.stringify(request.body ?? {}).length > 15 * 1024 * 1024) throw new Error("データが大きすぎます");
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body !== "object" || Array.isArray(body)) throw new Error("入力形式が正しくありません");
    if (method === "GET" && path === "/api/schedules") return { schedules: structuredClone(this.state.data.schedules) };
    if (method === "GET" && path === "/api/trash") return { schedules: structuredClone(this.state.data.trashSchedules) };
    if (method === "GET" && path === "/api/tags") return { tags: structuredClone(this.state.data.tags) };
    if (method === "GET" && path === "/api/baseline") return { baseline: structuredClone(this.state.baselines.find((item) => item.id === this.state.activeBaselineId) ?? null) };
    if (method === "GET" && path === "/api/baselines") return structuredClone(baselineHistory(this.state));
    const membersPath = `/api/groups/${groupId}/members`;
    if (method === "GET" && path === membersPath) return { users: structuredClone(this.state.members) };
    const imageMatch = path.match(/^\/api\/memo-images\/([a-f0-9-]{36})$/);
    if (method === "GET" && imageMatch) {
      const image = this.state.images.find((item) => item.id === imageMatch[1]);
      if (!image) throw new Error("画像が見つかりません");
      const bytes = await readFile(join(this.directory, "images", image.id));
      return { dataUrl: `data:${image.type};base64,${bytes.toString("base64")}` };
    }
    if (method === "POST" && path === "/api/client-logs") {
      await this.log("renderer_error");
      return { success: true };
    }

    // Commit a cloned state only after its durable SQLite replacement succeeds.
    const next = structuredClone(this.state);
    let result: unknown;
    let newImagePath: string | undefined;
    const memberMatch = path.match(new RegExp(`^${membersPath}/([a-f0-9-]{36})$`));
    const scheduleMatch = path.match(/^\/api\/schedules\/([a-zA-Z0-9-]+)$/);
    const restoreMatch = path.match(/^\/api\/trash\/([a-zA-Z0-9-]+)\/restore$/);
    const tagMatch = path.match(/^\/api\/tags\/([a-zA-Z0-9-]+)$/);
    const baselineMatch = path.match(/^\/api\/baselines\/([a-zA-Z0-9-]{1,100})$/);
    if ((path === "/api/baselines" || path === "/api/baseline") && method === "POST") {
      if (path === "/api/baseline" && next.activeBaselineId !== body.expectedId) throw new Error("比較基準が更新されています。再読み込みしてから保存してください");
      const baseline: ScheduleBaseline = { version: 1, id: randomUUID(), name: baselineName(body.name), savedAt: new Date().toISOString(), schedules: structuredClone(next.data.schedules), tags: structuredClone(next.data.tags) };
      next.baselines.unshift(baseline);
      next.activeBaselineId = baseline.id;
      result = { baseline, ...baselineHistory(next) };
    } else if (path === "/api/baseline" && method === "PATCH") {
      if (typeof body.id !== "string" || !next.baselines.some((item) => item.id === body.id)) throw new Error("保存状態が見つかりません");
      next.activeBaselineId = body.id;
      result = baselineHistory(next);
    } else if (baselineMatch && ["PATCH", "DELETE"].includes(method)) {
      const baseline = next.baselines.find((item) => item.id === baselineMatch[1]);
      if (!baseline) throw new Error("保存状態が見つかりません");
      if (method === "PATCH") baseline.name = baselineName(body.name);
      else {
        if (body.confirmId !== baseline.id) throw new Error("削除する保存状態を確認してください");
        next.baselines = next.baselines.filter((item) => item.id !== baseline.id);
        if (next.activeBaselineId === baseline.id) next.activeBaselineId = next.baselines[0]?.id ?? null;
      }
      result = baselineHistory(next);
    } else if (path === membersPath && method === "POST") {
      const user: AuthUser = { ...profile, id: randomUUID(), name: this.memberName(body.name, next), role: "User" };
      next.members.push(user);
      result = { user };
    } else if (memberMatch && ["PATCH", "DELETE"].includes(method)) {
      const user = next.members.find((item) => item.id === memberMatch[1]);
      if (!user) throw new Error("メンバーが見つかりません");
      if (method === "PATCH") {
        const oldName = user.name;
        user.name = this.memberName(body.name, next, user.id);
        for (const schedule of [...next.data.schedules, ...next.data.trashSchedules]) {
          if (schedule.memberIds?.includes(user.id)) {
            schedule.members = [...new Set(schedule.members.map((name) => name === oldName ? user.name : name))];
            schedule.updatedAt = new Date().toISOString();
          }
        }
      } else {
        // Deleting a candidate must not erase historical shifts or their names.
        next.members = next.members.filter((item) => item.id !== user.id);
      }
      result = { user };
    } else if (path === "/api/schedules" && method === "POST") {
      if (body.id && [...next.data.schedules, ...next.data.trashSchedules].some((item) => item.id === body.id)) throw new Error("予定IDが重複しています");
      result = { schedule: createSchedule(next.data, this.scheduleBody(body, next)) };
    } else if (scheduleMatch && method === "PUT") {
      result = { schedule: updateSchedule(next.data, scheduleMatch[1], this.scheduleBody(body, next)) };
    } else if (scheduleMatch && method === "DELETE") {
      result = { schedule: moveScheduleToTrash(next.data, scheduleMatch[1]) };
    } else if (restoreMatch && method === "POST") {
      result = { schedule: restoreSchedule(next.data, restoreMatch[1]) };
    } else if (path === "/api/tags" && method === "POST") {
      result = { tag: createTag(next.data, body, groupId) };
    } else if (tagMatch && method === "PATCH") {
      result = { tag: updateTag(next.data, tagMatch[1], body, groupId) };
    } else if (tagMatch && method === "DELETE") {
      result = { tag: deleteTag(next.data, tagMatch[1], groupId) };
    } else if (path === "/api/memo-images" && method === "POST") {
      const match = typeof body.dataUrl === "string" && body.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) throw new Error("PNG・JPEG・WebP・GIF画像を選択してください");
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error("画像は10MB以下にしてください");
      const image: MemoImage = { id: randomUUID(), name: String(body.name ?? "画像").slice(0, 255), type: match[1], createdAt: new Date().toISOString() };
      image.url = `/api/memo-images/${image.id}`;
      newImagePath = join(this.directory, "images", image.id);
      await writeDurable(newImagePath, bytes);
      next.images.push(image);
      result = { image };
    } else throw new Error("この操作はPC完結版では利用できません");
    try { await this.persist(next); }
    catch (error) {
      if (newImagePath) await unlink(newImagePath).catch(() => undefined);
      throw error;
    }
    this.state = next;
    await this.log("saved", method, path);
    return structuredClone(result);
  }

  private memberName(value: unknown, state: State, exceptId?: string) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new Error("名前を1〜100文字で入力してください");
    const name = value.trim();
    if (state.members.some((item) => item.id !== exceptId && item.name === name)) throw new Error("同じ名前のメンバーがいます。識別できる名前を指定してください");
    return name;
  }

  private scheduleBody(body: Record<string, unknown>, state: State): Partial<Schedule> {
    if (body.id !== undefined && (typeof body.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.id))) throw new Error("予定IDが正しくありません");
    for (const key of ["siteName", "content", "contractor", "address", "memo"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 100000)) throw new Error("テキスト形式が正しくありません");
    }
    for (const key of ["date", "endDate"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body[key]))) throw new Error("日付が正しくありません");
      if (typeof body[key] === "string" && new Date(`${body[key]}T00:00:00Z`).toISOString().slice(0, 10) !== body[key]) throw new Error("日付が正しくありません");
    }
    for (const key of ["startTime", "endTime"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body[key]))) throw new Error("時刻が正しくありません");
    }
    for (const key of ["members", "memberIds", "tagColors"]) {
      if (body[key] !== undefined && (!Array.isArray(body[key]) || !(body[key] as unknown[]).every((item) => typeof item === "string"))) throw new Error("リスト形式が正しくありません");
    }
    const images = (body.memoImages ?? []) as MemoImage[];
    if (!Array.isArray(images) || images.some((image) => !image || !state.images.some((saved) => saved.id === image.id))) throw new Error("保存されていない画像です");
    return { ...body, groupId, isPersonal: false, ownerUserId: undefined, readBy: [], readByUserIds: [], changeReadBy: [],
      memoImages: images.map((image) => ({ ...state.images.find((saved) => saved.id === image.id)!, name: String(image.name).slice(0, 255) })),
    };
  }

  private async persist(state: State) {
    this.db.run("BEGIN");
    try {
      this.db.run("INSERT OR REPLACE INTO calendar_state(id, payload) VALUES(1, ?)", [JSON.stringify(state)]);
      this.db.run("COMMIT");
      await writeDurable(join(this.directory, "calendar.sqlite.tmp"), this.db.export());
      await rename(join(this.directory, "calendar.sqlite.tmp"), join(this.directory, "calendar.sqlite"));
    } catch (error) {
      try { this.db.run("ROLLBACK"); } catch { /* COMMIT may already have completed. */ }
      this.db.run("INSERT OR REPLACE INTO calendar_state(id, payload) VALUES(1, ?)", [JSON.stringify(this.state)]);
      throw error;
    }
  }

  private async log(event: string, method?: string, path?: string) {
    try {
      const file = join(this.directory, "desktop.log");
      const size = (await stat(file).catch(() => null))?.size ?? 0;
      if (size > 1024 * 1024) await rename(file, `${file}.previous`);
      // No request contents, personal names, memo text, or image bytes in logs.
      await appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), event, method, resource: typeof path === "string" ? path.split("/")[2] : undefined })}\n`);
    } catch { /* Logging must not undo a saved shift. */ }
  }
}

async function writeDurable(path: string, bytes: Uint8Array) {
  const file = await open(path, "w", 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}
