import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequestId, logError, logInfo, logWarn } from "./logger.ts";
import { SqliteStore } from "./store.ts";
import type { Database, LoginBody, MemberPatch, RegisterBody, SchedulePatch, ServerUser } from "./domain.ts";
import { buildCorsHeaders, HttpError, notFound, parseJsonBody, sendJson, sendNoContent } from "./http.ts";
import {
  approveJoinRequest,
  canReadSchedule,
  createSchedule,
  createTag,
  deleteTag,
  filterSchedules,
  filterSchedulesForUser,
  getSessionUser,
  listTags,
  listGroupMembers,
  listJoinRequests,
  loginUser,
  logoutSession,
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
const defaultJsonBodyMaxBytes = Number(process.env.CALENDAR_JSON_BODY_MAX_BYTES ?? 1024 * 1024);
const memoImageBodyMaxBytes = Number(process.env.CALENDAR_MEMO_IMAGE_BODY_MAX_BYTES ?? 14 * 1024 * 1024);
const memoImageMaxBytes = Number(process.env.CALENDAR_MEMO_IMAGE_MAX_BYTES ?? 10 * 1024 * 1024);
const loginWindowMs = 10 * 60 * 1000;
const loginMaxFailures = 5;
const loginBlockMs = 5 * 60 * 1000;
const loginAttempts = new Map<string, { failures: number; firstFailedAt: number; blockedUntil?: number }>();
const registerWindowMs = 60 * 60 * 1000;
const registerMaxAttempts = 10;
const registerBlockMs = 60 * 60 * 1000;
const registerAttempts = new Map<string, { attempts: number; firstAttemptAt: number; blockedUntil?: number }>();
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"]);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const method = req.method ?? "GET";
  let pathname = req.url ?? "/";

  try {
    if (req.method === "OPTIONS") {
      sendNoContent(res, req.headers.origin);
      await logInfo("request", { requestId, method, pathname, status: 204, durationMs: Date.now() - startedAt });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    pathname = url.pathname;
    const memoImageReadMatch = pathname.match(/^\/api\/memo-images\/([^/]+)$/);
    if (method === "GET" && memoImageReadMatch) {
      const actor = await authenticate(req);
      const data = await store.read();
      assertCanReadMemoImage(data, actor, memoImageReadMatch[1]);
      await sendMemoImage(req, res, actor.groupId, memoImageReadMatch[1]);
      await logInfo("request", { requestId, method, pathname, status: 200, durationMs: Date.now() - startedAt });
      return;
    }

    const payload = await route(method, url.pathname, url.searchParams, req);
    sendJson(res, payload.status, payload.body, req.headers.origin);
    await logInfo("request", { requestId, method, pathname, status: payload.status, durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message }, req.headers.origin);
      await logWarn("http_error", { requestId, method, pathname, status: error.status, durationMs: Date.now() - startedAt, error: error.message });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    await logError("unhandled_error", {
      requestId,
      method,
      pathname,
      status: 500,
      durationMs: Date.now() - startedAt,
      error: errorMessage,
      stack: errorStack,
    });
    sendJson(res, 500, { error: "Internal server error" }, req.headers.origin);
  }
});

server.listen(port, host, () => {
  console.info("[Server.listen] Calendar API listening", { host, port });
  void logInfo("server_started", { host, port });
});

async function route(method: string, pathname: string, searchParams: URLSearchParams, req: IncomingMessage) {
  if (method === "GET" && pathname === "/health") {
    return ok({ ok: true });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const rateLimitKey = getClientIp(req);
    assertRegisterAllowed(rateLimitKey);
    recordRegisterAttempt(rateLimitKey);
    const body = await parseJsonBody<RegisterBody>(req, { maxBytes: defaultJsonBodyMaxBytes });
    let response: { status: number } & Record<string, unknown> = { status: 201 };
    await store.update((data) => {
      response = registerUser(data, body);
    });
    const { status, ...bodyPayload } = response;
    return { status, body: bodyPayload };
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseJsonBody<LoginBody>(req, { maxBytes: defaultJsonBodyMaxBytes });
    const rateLimitKey = getLoginRateLimitKey(req, body.email);
    assertLoginAllowed(rateLimitKey);
    let response: unknown;
    try {
      await store.update((data) => {
        response = loginUser(data, body);
      });
      clearLoginFailures(rateLimitKey);
    } catch (error) {
      recordLoginFailure(rateLimitKey);
      throw error;
    }
    return ok(response);
  }

  const actor = await authenticate(req);

  if (method === "POST" && pathname === "/api/client-logs") {
    const body = await parseJsonBody<Record<string, unknown>>(req, { maxBytes: defaultJsonBodyMaxBytes });
    await logWarn("client_log", {
      userId: actor.id,
      groupId: actor.groupId,
      level: body.level,
      message: body.message,
      stack: body.stack,
      path: body.path,
      userAgent: body.userAgent,
    });
    return { status: 202, body: { ok: true } };
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = getBearerToken(req);
    let response: unknown;
    await store.update((data) => {
      response = logoutSession(data, token);
    });
    return ok(response);
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    return ok({ user: publicUser(actor) });
  }

  if (method === "POST" && pathname === "/api/memo-images") {
    const body = await parseJsonBody<{ name?: string; type?: string; dataUrl?: string }>(req, { maxBytes: memoImageBodyMaxBytes });
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
    const body = await parseJsonBody<MemberPatch>(req, { maxBytes: defaultJsonBodyMaxBytes });
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
      response = approveJoinRequest(data, approveMatch[1], actor);
    });
    return ok(response);
  }

  if (method === "GET" && pathname === "/api/schedules") {
    const data = await store.read();
    return ok({ schedules: filterSchedulesForUser(data.schedules, actor, searchParams) });
  }

  if (method === "POST" && pathname === "/api/schedules") {
    const body = await parseJsonBody<SchedulePatch>(req, { maxBytes: defaultJsonBodyMaxBytes });
    let schedule: unknown;
    await store.update((data) => {
      schedule = createSchedule(data, body, actor);
    });
    return created({ schedule });
  }

  const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleMatch && method === "PUT") {
    const body = await parseJsonBody<SchedulePatch>(req, { maxBytes: defaultJsonBodyMaxBytes });
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
    const body = await parseJsonBody<{ member?: string }>(req, { maxBytes: defaultJsonBodyMaxBytes });
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
      schedule = restoreSchedule(data, restoreMatch[1], actor);
    });
    return ok({ schedule });
  }

  if (method === "GET" && pathname === "/api/tags") {
    let tags: unknown;
    await store.update((data) => {
      tags = listTags(data, actor.groupId);
    });
    return ok({ tags });
  }

  if (method === "POST" && pathname === "/api/tags") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    const body = await parseJsonBody<Record<string, string>>(req, { maxBytes: defaultJsonBodyMaxBytes });
    let tag: unknown;
    await store.update((data) => {
      tag = createTag(data, body, actor.groupId);
    });
    return created({ tag });
  }

  const tagMatch = pathname.match(/^\/api\/tags\/([^/]+)$/);
  if (tagMatch && method === "PATCH") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    const body = await parseJsonBody<Record<string, string>>(req, { maxBytes: defaultJsonBodyMaxBytes });
    let tag: unknown;
    await store.update((data) => {
      tag = updateTag(data, tagMatch[1], body, actor.groupId);
    });
    return ok({ tag });
  }

  if (tagMatch && method === "DELETE") {
    if (actor.role !== "Admin") throw new HttpError(403, "権限がありません");
    let tag: unknown;
    await store.update((data) => {
      tag = deleteTag(data, tagMatch[1], actor.groupId);
    });
    return ok({ tag });
  }

  return notFound(pathname);
}

async function authenticate(req: IncomingMessage) {
  const token = getBearerToken(req);
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
  if (!allowedImageTypes.has(type)) throw new HttpError(400, "対応している画像ファイルを指定してください");
  const imageBuffer = Buffer.from(match[3], "base64");
  if (imageBuffer.byteLength > memoImageMaxBytes) throw new HttpError(413, "画像ファイルが大きすぎます");

  const rawName = body.name?.trim() || "image";
  const id = randomUUID();
  const extension = getImageExtension(type, rawName);
  const directory = getMemoImageDirectory(groupId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}${extension}`), imageBuffer);

  return {
    id,
    name: rawName,
    type,
    url: `/api/memo-images/${id}`,
    createdAt: new Date().toISOString(),
  };
}

function assertCanReadMemoImage(data: Database, actor: ServerUser, imageId: string) {
  const imageUrl = `/api/memo-images/${imageId}`;
  const schedules = [...data.schedules, ...data.trashSchedules];
  const hasReadableImage = schedules.some((schedule) => (
    canReadSchedule(schedule, actor)
    && (schedule.memoImages ?? []).some((image) => image.id === imageId || image.url === imageUrl)
  ));

  if (!hasReadableImage) throw new HttpError(404, "画像が見つかりません");
}

async function sendMemoImage(req: IncomingMessage, res: ServerResponse, groupId: string, id: string) {
  if (!/^[0-9a-f-]+$/i.test(id)) throw new HttpError(400, "Invalid image id");
  const directory = getMemoImageDirectory(groupId);
  const candidates = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bin"];

  for (const extension of candidates) {
    try {
      const file = await readFile(join(directory, `${id}${extension}`));
      res.writeHead(200, {
        ...buildCorsHeaders(req.headers.origin),
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

function getBearerToken(req: IncomingMessage) {
  const rawAuthHeader = req.headers.authorization ?? "";
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] ?? "" : rawAuthHeader;
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

function getLoginRateLimitKey(req: IncomingMessage, email: unknown) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  return `${getClientIp(req)}:${normalizedEmail}`;
}

function getClientIp(req: IncomingMessage) {
  const forwardedFor = process.env.CALENDAR_TRUST_PROXY === "1" ? req.headers["x-forwarded-for"] : undefined;
  const firstForwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
  const socket = (req as IncomingMessage & { socket?: { remoteAddress?: string } }).socket;
  return (firstForwardedIp ?? socket?.remoteAddress ?? "unknown").trim();
}

function assertLoginAllowed(key: string) {
  const attempt = loginAttempts.get(key);
  if (!attempt?.blockedUntil) return;
  if (attempt.blockedUntil <= Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  throw new HttpError(429, "ログイン試行が多すぎます。しばらくしてから再試行してください");
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  const next = current && now - current.firstFailedAt <= loginWindowMs
    ? { ...current, failures: current.failures + 1 }
    : { failures: 1, firstFailedAt: now };

  if (next.failures >= loginMaxFailures) {
    next.blockedUntil = now + loginBlockMs;
  }
  loginAttempts.set(key, next);
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

function assertRegisterAllowed(key: string) {
  const attempt = registerAttempts.get(key);
  if (!attempt?.blockedUntil) return;
  if (attempt.blockedUntil <= Date.now()) {
    registerAttempts.delete(key);
    return;
  }
  throw new HttpError(429, "登録試行が多すぎます。しばらくしてから再試行してください");
}

function recordRegisterAttempt(key: string) {
  const now = Date.now();
  const current = registerAttempts.get(key);
  const next = current && now - current.firstAttemptAt <= registerWindowMs
    ? { ...current, attempts: current.attempts + 1 }
    : { attempts: 1, firstAttemptAt: now };

  if (next.attempts >= registerMaxAttempts) {
    next.blockedUntil = now + registerBlockMs;
  }
  registerAttempts.set(key, next);
}
