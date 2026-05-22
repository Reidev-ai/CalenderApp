import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequestId, logError, logInfo, logWarn } from "./logger.ts";
import { SqliteStore } from "./store.ts";
import type { LoginBody, MemberPatch, RegisterBody, SchedulePatch } from "./domain.ts";
import { HttpError, notFound, parseJsonBody, sendJson, sendNoContent } from "./http.ts";
import {
  approveJoinRequest,
  createSchedule,
  createTag,
  deleteTag,
  filterSchedules,
  filterSchedulesForUser,
  getSessionUser,
  listGroupMembers,
  listJoinRequests,
  loginUser,
  markScheduleRead,
  markScheduleChangeRead,
  moveScheduleToTrash,
  publicUser,
  registerUser,
  removeGroupMember,
  restoreSchedule,
  updateGroupMember,
  updateSchedule,
  updateTag,
} from "./services.ts";

const store = new SqliteStore();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const method = req.method ?? "GET";
  let pathname = req.url ?? "/";

  try {
    if (req.method === "OPTIONS") {
      sendNoContent(res);
      await logInfo("request", { requestId, method, pathname, status: 204, durationMs: Date.now() - startedAt });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    pathname = url.pathname;
    const memoImageReadMatch = pathname.match(/^\/api\/memo-images\/([^/]+)$/);
    if (method === "GET" && memoImageReadMatch) {
      const actor = await authenticate(req);
      await sendMemoImage(res, actor.groupId, memoImageReadMatch[1]);
      await logInfo("request", { requestId, method, pathname, status: 200, durationMs: Date.now() - startedAt });
      return;
    }

    const payload = await route(method, url.pathname, url.searchParams, req);
    sendJson(res, payload.status, payload.body);
    await logInfo("request", { requestId, method, pathname, status: payload.status, durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      await logWarn("http_error", { requestId, method, pathname, status: error.status, durationMs: Date.now() - startedAt, error: error.message });
      return;
    }

    console.error(error);
    await logError("unhandled_error", {
      requestId,
      method,
      pathname,
      status: 500,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Calendar API listening on http://${host}:${port}`);
  void logInfo("server_started", { host, port });
});

async function route(method: string, pathname: string, searchParams: URLSearchParams, req: IncomingMessage) {
  if (method === "GET" && pathname === "/health") {
    return ok({ ok: true });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await parseJsonBody<RegisterBody>(req);
    let response: { status: number } & Record<string, unknown> = { status: 201 };
    await store.update((data) => {
      response = registerUser(data, body);
    });
    const { status, ...bodyPayload } = response;
    return { status, body: bodyPayload };
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseJsonBody<LoginBody>(req);
    let response: unknown;
    await store.update((data) => {
      response = loginUser(data, body);
    });
    return ok(response);
  }

  if (method === "POST" && pathname === "/api/client-logs") {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    await logWarn("client_log", {
      level: body.level,
      message: body.message,
      stack: body.stack,
      path: body.path,
      userAgent: body.userAgent,
    });
    return { status: 202, body: { ok: true } };
  }

  const actor = await authenticate(req);

  if (method === "GET" && pathname === "/api/auth/me") {
    return ok({ user: publicUser(actor) });
  }

  if (method === "POST" && pathname === "/api/memo-images") {
    const body = await parseJsonBody<{ name?: string; type?: string; dataUrl?: string }>(req);
    return created({ image: await saveMemoImage(actor.groupId, body) });
  }

  if (method === "GET" && pathname === "/api/groups") {
    const data = await store.read();
    return ok({ groups: data.groups.filter((group) => group.id === actor.groupId) });
  }

  const groupMembersMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members$/);
  if (method === "GET" && groupMembersMatch) {
    if (groupMembersMatch[1] !== actor.groupId) throw new HttpError(403, "権限がありません");
    const data = await store.read();
    return ok(listGroupMembers(data, groupMembersMatch[1]));
  }

  const groupMemberMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (method === "PATCH" && groupMemberMatch) {
    if (actor.role !== "Admin" || groupMemberMatch[1] !== actor.groupId) throw new HttpError(403, "権限がありません");
    const body = await parseJsonBody<MemberPatch>(req);
    let response: unknown;
    await store.update((data) => {
      response = updateGroupMember(data, groupMemberMatch[1], groupMemberMatch[2], body);
    });
    return ok(response);
  }

  if (method === "DELETE" && groupMemberMatch) {
    if (actor.role !== "Admin" || groupMemberMatch[1] !== actor.groupId) throw new HttpError(403, "権限がありません");
    let response: unknown;
    await store.update((data) => {
      response = removeGroupMember(data, groupMemberMatch[1], groupMemberMatch[2]);
    });
    return ok(response);
  }

  if (method === "GET" && pathname === "/api/join-requests") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    const data = await store.read();
    const requestedGroupId = searchParams.get("groupId");
    if (requestedGroupId && requestedGroupId !== actor.groupId) throw new HttpError(403, "権限がありません");
    const joinRequests = listJoinRequests(data, actor.groupId);
    return ok({ joinRequests });
  }

  const approveMatch = pathname.match(/^\/api\/join-requests\/([^/]+)\/approve$/);
  if (method === "POST" && approveMatch) {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    let response: unknown;
    await store.update((data) => {
      response = approveJoinRequest(data, approveMatch[1]);
    });
    return ok(response);
  }

  if (method === "GET" && pathname === "/api/schedules") {
    const data = await store.read();
    return ok({ schedules: filterSchedulesForUser(data.schedules, actor, searchParams) });
  }

  if (method === "POST" && pathname === "/api/schedules") {
    const body = await parseJsonBody<SchedulePatch>(req);
    let schedule: unknown;
    await store.update((data) => {
      schedule = createSchedule(data, body, actor);
    });
    return created({ schedule });
  }

  const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleMatch && method === "PUT") {
    const body = await parseJsonBody<SchedulePatch>(req);
    let schedule: unknown;
    await store.update((data) => {
      schedule = updateSchedule(data, scheduleMatch[1], body, actor);
    });
    return ok({ schedule });
  }

  if (scheduleMatch && method === "DELETE") {
    let schedule: unknown;
    await store.update((data) => {
      schedule = moveScheduleToTrash(data, scheduleMatch[1], actor);
    });
    return ok({ schedule });
  }

  const readMatch = pathname.match(/^\/api\/schedules\/([^/]+)\/read$/);
  if (readMatch && method === "POST") {
    const body = await parseJsonBody<{ member?: string }>(req);
    if (!body.member) throw new HttpError(400, "member is required");
    const member = body.member;
    let schedule: unknown;
    await store.update((data) => {
      schedule = markScheduleRead(data, readMatch[1], member, actor);
    });
    return ok({ schedule });
  }

  const changeReadMatch = pathname.match(/^\/api\/schedules\/([^/]+)\/change-read$/);
  if (changeReadMatch && method === "POST") {
    let schedule: unknown;
    await store.update((data) => {
      schedule = markScheduleChangeRead(data, changeReadMatch[1], actor.id, actor);
    });
    return ok({ schedule });
  }

  if (method === "GET" && pathname === "/api/trash") {
    if (actor.role !== "Admin") return ok({ schedules: [] });
    const data = await store.read();
    return ok({ schedules: data.trashSchedules.filter((schedule) => schedule.groupId === actor.groupId) });
  }

  const restoreMatch = pathname.match(/^\/api\/trash\/([^/]+)\/restore$/);
  if (restoreMatch && method === "POST") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    let schedule: unknown;
    await store.update((data) => {
      schedule = restoreSchedule(data, restoreMatch[1]);
    });
    return ok({ schedule });
  }

  if (method === "GET" && pathname === "/api/tags") {
    const data = await store.read();
    return ok({ tags: data.tags });
  }

  if (method === "POST" && pathname === "/api/tags") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    const body = await parseJsonBody<Record<string, string>>(req);
    let tag: unknown;
    await store.update((data) => {
      tag = createTag(data, body);
    });
    return created({ tag });
  }

  const tagMatch = pathname.match(/^\/api\/tags\/([^/]+)$/);
  if (tagMatch && method === "PATCH") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    const body = await parseJsonBody<Record<string, string>>(req);
    let tag: unknown;
    await store.update((data) => {
      tag = updateTag(data, tagMatch[1], body);
    });
    return ok({ tag });
  }

  if (tagMatch && method === "DELETE") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    let tag: unknown;
    await store.update((data) => {
      tag = deleteTag(data, tagMatch[1]);
    });
    return ok({ tag });
  }

  return notFound(pathname);
}

async function authenticate(req: IncomingMessage) {
  const rawAuthHeader = req.headers.authorization ?? "";
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] ?? "" : rawAuthHeader;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const data = await store.read();
  return getSessionUser(data, token);
}

function ok(body: unknown) {
  return { status: 200, body };
}

function created(body: unknown) {
  return { status: 201, body };
}

async function saveMemoImage(groupId: string, body: { name?: string; type?: string; dataUrl?: string }) {
  if (!body.dataUrl) throw new HttpError(400, "dataUrl is required");
  const match = body.dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match || !match[2]) throw new HttpError(400, "Invalid image data");

  const type = body.type || match[1] || "application/octet-stream";
  if (!type.startsWith("image/")) throw new HttpError(400, "画像ファイルを指定してください");

  const rawName = body.name?.trim() || "image";
  const id = randomUUID();
  const extension = getImageExtension(type, rawName);
  const directory = getMemoImageDirectory(groupId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}${extension}`), Buffer.from(match[3], "base64"));

  return {
    id,
    name: rawName,
    type,
    url: `/api/memo-images/${id}`,
    createdAt: new Date().toISOString(),
  };
}

async function sendMemoImage(res: ServerResponse, groupId: string, id: string) {
  if (!/^[0-9a-f-]+$/i.test(id)) throw new HttpError(400, "Invalid image id");
  const directory = getMemoImageDirectory(groupId);
  const candidates = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bin"];

  for (const extension of candidates) {
    try {
      const file = await readFile(join(directory, `${id}${extension}`));
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "private, max-age=3600",
        "Content-Type": getContentType(extension),
      });
      res.end(file);
      return;
    } catch {
      // Try the next known extension.
    }
  }

  throw new HttpError(404, "画像が見つかりません");
}

function getMemoImageDirectory(groupId: string) {
  const dataDir = process.env.CALENDAR_DATA_DIR ?? new URL("../data/", import.meta.url).pathname;
  return join(dataDir, "memo-images", groupId);
}

function getImageExtension(type: string, name: string) {
  const extension = extname(name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"].includes(extension)) return extension;
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/gif") return ".gif";
  if (type === "image/webp") return ".webp";
  if (type === "image/heic") return ".heic";
  return ".bin";
}

function getContentType(extension: string) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".heic") return "image/heic";
  return "application/octet-stream";
}
