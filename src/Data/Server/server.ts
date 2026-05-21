import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { JsonStore } from "./store.ts";
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
  registerUser,
  removeGroupMember,
  restoreSchedule,
  updateGroupMember,
  updateSchedule,
  updateTag,
} from "./services.ts";

const store = new JsonStore();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const payload = await route(req.method ?? "GET", url.pathname, url.searchParams, req);
    sendJson(res, payload.status, payload.body);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }

    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Calendar API listening on http://${host}:${port}`);
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

  const actor = await authenticate(req);

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
    const groupId = searchParams.get("groupId");
    const joinRequests = listJoinRequests(data, groupId ?? undefined);
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
    return ok({ schedules: data.trashSchedules.filter((schedule) => !schedule.groupId || schedule.groupId === actor.groupId) });
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
