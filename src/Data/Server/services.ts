import crypto, { createHash, randomUUID } from "node:crypto";
import type { MemoImage, Schedule, Tag, UserRole } from "../../types.ts";
import type { Database, LoginBody, MemberPatch, PublicUser, RegisterBody, SchedulePatch, ServerUser } from "./domain.ts";
import { HttpError } from "./http.ts";

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const passwordHashPrefix = "scrypt";
const passwordKeyLength = 64;
const passwordCrypto = crypto as typeof crypto & {
  randomBytes: (size: number) => { toString: (encoding: "hex") => string };
  scryptSync: (password: string, salt: string, keylen: number) => Uint8Array;
  timingSafeEqual: (left: Uint8Array, right: Uint8Array) => boolean;
};
const defaultTagTemplates = [
  { id: "blue", name: "通常", color: "#3b82f6" },
  { id: "green", name: "確認", color: "#22c55e" },
  { id: "orange", name: "注意", color: "#f97316" },
  { id: "red", name: "重要", color: "#ef4444" },
  { id: "purple", name: "夜間", color: "#a855f7" },
  { id: "teal", name: "調査", color: "#14b8a6" },
];

export function publicUser(user: ServerUser): PublicUser {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export function hashPassword(password: string) {
  const salt = passwordCrypto.randomBytes(16).toString("hex");
  const hash = bytesToHex(passwordCrypto.scryptSync(password, salt, passwordKeyLength));
  return `${passwordHashPrefix}$${salt}$${hash}`;
}

export function registerUser(data: Database, body: RegisterBody) {
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  const name = requireString(body.name, "name");

  if (data.users.some((user) => user.email === email)) {
    throw new HttpError(409, "このメールアドレスは登録済みです");
  }

  if (body.groupId) {
    const group = data.groups.find((item) => item.id === body.groupId);
    if (!group) throw new HttpError(404, "指定されたグループIDが見つかりません");

    const user = createUser(email, password, name, "User", group.id, true);
    const request = {
      id: randomUUID(),
      groupId: group.id,
      userId: user.id,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
    };

    data.users.push(user);
    data.joinRequests.push(request);

    return { status: 202, user: publicUser(user), joinRequest: request };
  }

  if (body.groupName) {
    const groupName = body.groupName.trim();
    if (!groupName) throw new HttpError(400, "groupName is required");
    if (data.groups.some((group) => group.name === groupName)) {
      throw new HttpError(409, "同じグループ名がすでにあります");
    }

    const group = { id: randomUUID(), name: groupName, adminIds: [] as string[], memberIds: [] as string[] };
    const user = createUser(email, password, name, "Admin", group.id, false);
    group.adminIds.push(user.id);
    group.memberIds.push(user.id);
    data.groups.push(group);
    data.users.push(user);
    ensureGroupTags(data, group.id);

    return { status: 201, user: publicUser(user), group };
  }

  const group = { id: randomUUID(), name: `${name}の予定`, adminIds: [] as string[], memberIds: [] as string[] };
  const user = createUser(email, password, name, "Admin", group.id, false);
  group.adminIds.push(user.id);
  group.memberIds.push(user.id);
  data.groups.push(group);
  data.users.push(user);
  ensureGroupTags(data, group.id);

  return { status: 201, user: publicUser(user), group };
}

export function loginUser(data: Database, body: LoginBody) {
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  const user = data.users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) throw new HttpError(401, "メールアドレスかパスワードが違います");
  if (user.pending) throw new HttpError(403, "参加申請がまだ承認されていません");

  if (!isCurrentPasswordHash(user.passwordHash)) {
    user.passwordHash = hashPassword(password);
  }

  const createdAt = new Date();
  const session = {
    token: randomUUID(),
    userId: user.id,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + sessionTtlMs).toISOString(),
  };
  data.sessions.push(session);

  return { token: session.token, user: publicUser(user) };
}

export function getSessionUser(data: Database, token: string | null | undefined) {
  if (!token) throw new HttpError(401, "認証が必要です");
  const session = data.sessions.find((item) => item.token === token);
  if (!session) throw new HttpError(401, "セッションが無効です");
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    throw new HttpError(401, "セッションの期限が切れています");
  }
  const user = data.users.find((item) => item.id === session.userId);
  if (!user || user.pending) throw new HttpError(401, "ユーザーが見つかりません");
  return user;
}

export function logoutSession(data: Database, token: string) {
  data.sessions = data.sessions.filter((session) => session.token !== token);
  return { ok: true };
}

export function approveJoinRequest(data: Database, requestId: string, actor?: ServerUser) {
  const request = data.joinRequests.find((item) => item.id === requestId);
  if (!request) throw new HttpError(404, "参加申請が見つかりません");
  if (request.status !== "pending") throw new HttpError(409, "この参加申請は処理済みです");
  if (actor && (actor.role !== "Admin" || request.groupId !== actor.groupId)) {
    throw new HttpError(403, "権限がありません");
  }

  const user = data.users.find((item) => item.id === request.userId);
  const group = data.groups.find((item) => item.id === request.groupId);
  if (!user || !group) throw new HttpError(404, "参加申請のユーザーまたはグループが見つかりません");

  request.status = "approved";
  user.pending = false;
  if (!group.memberIds.includes(user.id)) group.memberIds.push(user.id);

  return { joinRequest: request, user: publicUser(user), group };
}

export function listJoinRequests(data: Database, groupId?: string) {
  const requests = groupId
    ? data.joinRequests.filter((request) => request.groupId === groupId)
    : data.joinRequests;

  return requests.map((request) => {
    const user = data.users.find((item) => item.id === request.userId);
    const group = data.groups.find((item) => item.id === request.groupId);

    return {
      ...request,
      user: user ? publicUser(user) : undefined,
      group,
    };
  });
}

export function listGroupMembers(data: Database, groupId: string) {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) throw new HttpError(404, "グループが見つかりません");

  const users = data.users
    .filter((user) => !user.pending && (group.memberIds.includes(user.id) || user.groupId === groupId))
    .map(publicUser)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return { group, users };
}

export function updateGroupMember(data: Database, groupId: string, userId: string, patch: MemberPatch) {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) throw new HttpError(404, "グループが見つかりません");

  const user = data.users.find((item) => item.id === userId && item.groupId === groupId);
  if (!user) throw new HttpError(404, "メンバーが見つかりません");

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new HttpError(400, "name is required");
    user.name = name;
  }

  if (patch.role !== undefined) {
    if (!isAssignableRole(patch.role)) throw new HttpError(400, "role must be Admin or User");
    if (user.role === "Admin" && patch.role !== "Admin" && group.adminIds.length <= 1) {
      throw new HttpError(409, "最後のAdminは降格できません");
    }
    user.role = patch.role;
    group.adminIds = patch.role === "Admin"
      ? [...new Set([...group.adminIds, user.id])]
      : group.adminIds.filter((id) => id !== user.id);
  }

  return { user: publicUser(user), group };
}

function isAssignableRole(value: unknown): value is "Admin" | "User" {
  return value === "Admin" || value === "User";
}

export function removeGroupMember(data: Database, groupId: string, userId: string) {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) throw new HttpError(404, "グループが見つかりません");

  const user = data.users.find((item) => item.id === userId && item.groupId === groupId);
  if (!user) throw new HttpError(404, "メンバーが見つかりません");
  if (group.adminIds.includes(user.id) && group.adminIds.length <= 1) {
    throw new HttpError(409, "最後のAdminは削除できません");
  }

  group.memberIds = group.memberIds.filter((id) => id !== user.id);
  group.adminIds = group.adminIds.filter((id) => id !== user.id);
  data.users = data.users.filter((item) => item.id !== user.id);
  data.sessions = data.sessions.filter((session) => session.userId !== user.id);
  data.joinRequests = data.joinRequests.filter((request) => request.userId !== user.id);

  return { user: publicUser(user), group };
}

export function filterSchedules(schedules: Schedule[], query: URLSearchParams) {
  const role = query.get("role") as UserRole | null;
  const member = query.get("member") ?? "";
  const text = query.get("query")?.trim().toLowerCase() ?? "";
  const tag = query.get("tag") ?? "";

  return schedules.filter((schedule) => {
    if (role === "User" && member && !schedule.members.includes(member) && !(schedule.memberIds ?? []).includes(member) && !schedule.isPersonal) return false;
    if (role === "Guest" && member && !schedule.members.includes(member) && !(schedule.memberIds ?? []).includes(member)) return false;
    if (tag && !getScheduleTagColors(schedule).includes(tag)) return false;
    if (!text) return true;

    return [
    schedule.siteName,
    schedule.content,
    schedule.date,
    schedule.endDate,
    schedule.startTime,
      schedule.endTime,
      schedule.members.join(" "),
      schedule.contractor,
      schedule.address,
      schedule.memo,
    ]
      .join(" ")
      .toLowerCase()
      .includes(text);
  });
}

export function filterSchedulesForUser(schedules: Schedule[], actor: ServerUser, query: URLSearchParams) {
  const scopedSchedules = schedules.filter((schedule) => canReadSchedule(schedule, actor));

  return filterSchedules(scopedSchedules, query);
}

export function createSchedule(data: Database, body: SchedulePatch, actor?: ServerUser) {
  if (actor && actor.role === "Guest") throw new HttpError(403, "権限がありません");
  const isPersonal = actor?.role === "User" ? true : body.isPersonal;
  const schedule = normalizeSchedule({
    ...body,
    groupId: actor?.groupId ?? body.groupId,
    ownerUserId: isPersonal ? actor?.id ?? body.ownerUserId : body.ownerUserId,
    isPersonal,
  });
  data.schedules.push(schedule);
  return schedule;
}

export function updateSchedule(data: Database, scheduleId: string, patch: SchedulePatch, actor?: ServerUser) {
  const index = data.schedules.findIndex((schedule) => schedule.id === scheduleId);
  if (index === -1) throw new HttpError(404, "スケジュールが見つかりません");
  const currentSchedule = data.schedules[index];
  if (actor) assertCanWriteSchedule(currentSchedule, actor);

  const safePatch = actor?.role === "User"
    ? {
        ...patch,
        groupId: actor.groupId,
        ownerUserId: actor.id,
        isPersonal: true,
      }
    : patch;

  data.schedules[index] = normalizeSchedule({
    ...currentSchedule,
    ...safePatch,
    id: scheduleId,
    groupId: currentSchedule.groupId ?? actor?.groupId ?? safePatch.groupId,
    ownerUserId: actor?.role === "User" ? actor.id : currentSchedule.ownerUserId ?? safePatch.ownerUserId,
  });
  return data.schedules[index];
}

export function moveScheduleToTrash(data: Database, scheduleId: string, actor?: ServerUser) {
  const index = data.schedules.findIndex((schedule) => schedule.id === scheduleId);
  if (index === -1) throw new HttpError(404, "スケジュールが見つかりません");
  if (actor) assertCanWriteSchedule(data.schedules[index], actor);

  const [schedule] = data.schedules.splice(index, 1);
  data.trashSchedules.unshift(schedule);
  return schedule;
}

export function restoreSchedule(data: Database, scheduleId: string, actor?: ServerUser) {
  const index = data.trashSchedules.findIndex((schedule) => schedule.id === scheduleId);
  if (index === -1) throw new HttpError(404, "ゴミ箱にスケジュールが見つかりません");
  if (actor && (actor.role !== "Admin" || data.trashSchedules[index].groupId !== actor.groupId)) {
    throw new HttpError(403, "権限がありません");
  }

  const [schedule] = data.trashSchedules.splice(index, 1);
  data.schedules.push(schedule);
  return schedule;
}

export function markScheduleRead(data: Database, scheduleId: string, member: string, actor?: ServerUser) {
  const schedule = data.schedules.find((item) => item.id === scheduleId);
  if (!schedule) throw new HttpError(404, "スケジュールが見つかりません");
  if (actor && !canReadSchedule(schedule, actor)) throw new HttpError(403, "権限がありません");
  const readerName = actor?.name ?? member;
  if (!schedule.readBy.includes(readerName)) schedule.readBy.push(readerName);
  if (actor) schedule.readByUserIds = [...new Set([...(schedule.readByUserIds ?? []), actor.id])];
  return schedule;
}

export function markScheduleChangeRead(data: Database, scheduleId: string, userId: string, actor?: ServerUser) {
  const schedule = data.schedules.find((item) => item.id === scheduleId);
  if (!schedule) throw new HttpError(404, "スケジュールが見つかりません");
  if (actor && !canReadSchedule(schedule, actor)) throw new HttpError(403, "権限がありません");
  schedule.changeReadBy = [...new Set([...(schedule.changeReadBy ?? []), userId])];
  return schedule;
}

export function listTags(data: Database, groupId: string) {
  ensureGroupTags(data, groupId);
  return data.tags.filter((tag) => tag.groupId === groupId);
}

export function createTag(data: Database, body: Partial<Tag>, groupId: string) {
  const tag = {
    id: body.id ?? randomUUID(),
    groupId,
    name: requireString(body.name, "name"),
    color: requireString(body.color, "color"),
  };
  data.tags.push(tag);
  return tag;
}

export function updateTag(data: Database, tagId: string, patch: Partial<Tag>, groupId: string) {
  const tag = data.tags.find((item) => item.id === tagId && item.groupId === groupId);
  if (!tag) throw new HttpError(404, "タグが見つかりません");
  if (patch.name !== undefined) tag.name = patch.name;
  if (patch.color !== undefined) tag.color = patch.color;
  return tag;
}

export function deleteTag(data: Database, tagId: string, groupId: string) {
  const tag = data.tags.find((item) => item.id === tagId && item.groupId === groupId);
  if (!tag) throw new HttpError(404, "タグが見つかりません");
  data.tags = data.tags.filter((item) => item.id !== tagId);
  data.schedules = data.schedules.map((schedule) => schedule.groupId === groupId ? removeTagFromSchedule(schedule, tag.color) : schedule);
  data.trashSchedules = data.trashSchedules.map((schedule) => schedule.groupId === groupId ? removeTagFromSchedule(schedule, tag.color) : schedule);
  return tag;
}

function createUser(email: string, password: string, name: string, role: UserRole, groupId: string, pending: boolean): ServerUser {
  return {
    id: randomUUID(),
    email,
    name,
    passwordHash: hashPassword(password),
    role,
    groupId,
    pending,
  };
}

function normalizeSchedule(input: SchedulePatch): Schedule {
  const now = new Date().toISOString();
  const schedule = {
    id: input.id ?? randomUUID(),
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    siteName: input.siteName ?? "新規現場",
    content: input.content ?? "",
    date: input.date ?? new Date().toISOString().slice(0, 10),
    endDate: input.endDate ?? input.date ?? new Date().toISOString().slice(0, 10),
    startTime: normalizeTimeString(input.startTime ?? "09:00"),
    endTime: normalizeTimeString(input.endTime ?? "10:00"),
    members: input.members ?? [],
    memberIds: input.memberIds ?? [],
    contractor: input.contractor ?? "",
    address: input.address ?? "",
    memo: input.memo ?? "",
    memoImages: normalizeMemoImages(input.memoImages),
    tagColor: input.tagColor ?? input.tagColors?.[0] ?? "#3b82f6",
    tagColors: input.tagColors ?? [input.tagColor ?? "#3b82f6"],
    readBy: input.readBy ?? [],
    readByUserIds: input.readByUserIds ?? [],
    changeReadBy: input.changeReadBy ?? [],
    isPersonal: input.isPersonal ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };

  if (schedule.endDate < schedule.date) {
    schedule.endDate = schedule.date;
    schedule.endTime = schedule.startTime;
  }

  if (schedule.endDate === schedule.date && timeStringToMinutes(schedule.endTime) < timeStringToMinutes(schedule.startTime)) {
    schedule.endTime = schedule.startTime;
  }

  return schedule;
}

function assertCanWriteSchedule(schedule: Schedule, actor: ServerUser) {
  if (schedule.groupId !== actor.groupId) throw new HttpError(403, "権限がありません");
  if (actor.role === "Admin" && !schedule.isPersonal) return;
  if (actor.role === "User" && schedule.isPersonal && schedule.ownerUserId === actor.id) return;
  throw new HttpError(403, "権限がありません");
}

export function canReadSchedule(schedule: Schedule, actor: ServerUser) {
  if (schedule.groupId !== actor.groupId) return false;
  if (schedule.isPersonal) return schedule.ownerUserId === actor.id;
  if (actor.role === "Admin") return true;
  return (schedule.memberIds ?? []).includes(actor.id) || schedule.members.includes(actor.name);
}

function normalizeMemoImages(images: MemoImage[] = []) {
  return images.map((image) => ({
    id: image.id,
    name: image.name,
    type: image.type,
    url: image.url ?? `/api/memo-images/${image.id}`,
    createdAt: image.createdAt,
  }));
}

function normalizeTimeString(time: string) {
  const [rawHour, rawMinute] = time.split(":").map(Number);
  const hour = Math.min(23, Math.max(0, Number.isFinite(rawHour) ? rawHour : 0));
  const minute = Math.min(59, Math.max(0, Number.isFinite(rawMinute) ? rawMinute : 0));
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function timeStringToMinutes(time: string) {
  const [rawHour, rawMinute] = normalizeTimeString(time).split(":").map(Number);
  return rawHour * 60 + rawMinute;
}

function removeTagFromSchedule(schedule: Schedule, color: string): Schedule {
  const nextColors = getScheduleTagColors(schedule).filter((tagColor) => tagColor !== color);
  return {
    ...schedule,
    tagColors: nextColors,
    tagColor: nextColors[0] ?? "#3b82f6",
  };
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}

function ensureGroupTags(data: Database, groupId: string) {
  const hasGroupTags = data.tags.some((tag) => tag.groupId === groupId);
  if (hasGroupTags) return;

  data.tags.push(...defaultTagTemplates.map((tag) => ({
    ...tag,
    id: `${groupId}-${tag.id}`,
    groupId,
  })));
}

function verifyPassword(password: string, storedHash: string) {
  if (isCurrentPasswordHash(storedHash)) {
    const [, salt, hash] = storedHash.split("$");
    if (!salt || !hash) return false;
    const expected = hexToBytes(hash);
    if (expected.length !== passwordKeyLength) return false;
    const actual = passwordCrypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && passwordCrypto.timingSafeEqual(expected, actual);
  }

  return legacySha256PasswordHash(password) === storedHash;
}

function isCurrentPasswordHash(storedHash: string) {
  return storedHash.startsWith(`${passwordHashPrefix}$`);
}

function legacySha256PasswordHash(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return new Uint8Array();
    bytes[index] = byte;
  }
  return bytes;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }

  return value.trim();
}
