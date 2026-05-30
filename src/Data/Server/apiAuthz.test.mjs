import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

let serverProcess;
let dataDir;

try {
  const port = await getFreePort();
  dataDir = await mkdtemp(path.join(tmpdir(), "calendar-api-authz-"));
  serverProcess = await startApiServer(port, dataDir);
  const baseUrl = `http://127.0.0.1:${port}`;

  await assertProductionCorsRequiresConfiguredOrigin(baseUrl);
  await assertForwardedForRateLimitCannotBeSpoofed(baseUrl);

  const adminARegister = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      email: "admin-a@example.test",
      password: "password-a",
      name: "Admin A",
      groupName: "Group A",
    },
    expectedStatus: 201,
  });
  const groupAId = adminARegister.group.id;
  const adminA = await login(baseUrl, "admin-a@example.test", "password-a");

  await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      email: "admin-b@example.test",
      password: "password-b",
      name: "Admin B",
      groupName: "Group B",
    },
    expectedStatus: 201,
  });
  const adminB = await login(baseUrl, "admin-b@example.test", "password-b");

  await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      email: "user-a@example.test",
      password: "password-user",
      name: "User A",
      groupId: groupAId,
    },
    expectedStatus: 202,
  });

  const joinRequests = await requestJson(baseUrl, "/api/join-requests", { token: adminA.token });
  assert.equal(joinRequests.joinRequests.length, 1);
  await requestJson(baseUrl, `/api/join-requests/${joinRequests.joinRequests[0].id}/approve`, {
    method: "POST",
    token: adminA.token,
  });
  const userA = await login(baseUrl, "user-a@example.test", "password-user");

  const hiddenSchedule = await requestJson(baseUrl, "/api/schedules", {
    method: "POST",
    token: adminA.token,
    body: buildSchedule({ siteName: "Hidden group schedule" }),
    expectedStatus: 201,
  });

  const userSchedules = await requestJson(baseUrl, "/api/schedules", { token: userA.token });
  assert.equal(userSchedules.schedules.some((schedule) => schedule.id === hiddenSchedule.schedule.id), false);

  await requestJson(baseUrl, `/api/schedules/${hiddenSchedule.schedule.id}/read`, {
    method: "POST",
    token: userA.token,
    body: { member: "User A" },
    expectedStatus: 403,
  });
  await requestJson(baseUrl, `/api/schedules/${hiddenSchedule.schedule.id}/change-read`, {
    method: "POST",
    token: userA.token,
    expectedStatus: 403,
  });

  const assignedSchedule = await requestJson(baseUrl, "/api/schedules", {
    method: "POST",
    token: adminA.token,
    body: buildSchedule({
      siteName: "Assigned schedule",
      members: ["User A"],
      memberIds: [userA.user.id],
    }),
    expectedStatus: 201,
  });
  const readSchedule = await requestJson(baseUrl, `/api/schedules/${assignedSchedule.schedule.id}/read`, {
    method: "POST",
    token: userA.token,
    body: { member: "Admin A" },
  });
  assert.equal(readSchedule.schedule.readBy.includes("Admin A"), false);
  assert.equal(readSchedule.schedule.readBy.includes("User A"), true);
  assert.equal(readSchedule.schedule.readByUserIds.includes(userA.user.id), true);

  const personalSchedule = await requestJson(baseUrl, "/api/schedules", {
    method: "POST",
    token: userA.token,
    body: buildSchedule({
      siteName: "Personal schedule",
      isPersonal: false,
      ownerUserId: adminA.user.id,
      members: ["Admin A"],
      memberIds: [adminA.user.id],
    }),
    expectedStatus: 201,
  });
  assert.equal(personalSchedule.schedule.isPersonal, true);
  assert.equal(personalSchedule.schedule.ownerUserId, userA.user.id);

  const updatedPersonalSchedule = await requestJson(baseUrl, `/api/schedules/${personalSchedule.schedule.id}`, {
    method: "PUT",
    token: userA.token,
    body: {
      isPersonal: false,
      ownerUserId: adminA.user.id,
      members: ["Admin A"],
      memberIds: [adminA.user.id],
    },
  });
  assert.equal(updatedPersonalSchedule.schedule.isPersonal, true);
  assert.equal(updatedPersonalSchedule.schedule.ownerUserId, userA.user.id);

  const adminSchedules = await requestJson(baseUrl, "/api/schedules", { token: adminA.token });
  assert.equal(adminSchedules.schedules.some((schedule) => schedule.id === personalSchedule.schedule.id), false);

  const imagePayload = await requestJson(baseUrl, "/api/memo-images", {
    method: "POST",
    token: adminA.token,
    body: {
      name: "proof.png",
      type: "image/png",
      dataUrl: onePixelPng,
    },
    expectedStatus: 201,
  });
  const imageSchedule = await requestJson(baseUrl, "/api/schedules", {
    method: "POST",
    token: adminA.token,
    body: buildSchedule({
      siteName: "Schedule with image",
      memoImages: [imagePayload.image],
    }),
    expectedStatus: 201,
  });
  assert.equal(imageSchedule.schedule.memoImages[0].dataUrl, undefined);

  const imageResponse = await requestRaw(baseUrl, imagePayload.image.url, { token: adminA.token, expectedStatus: 200 });
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  await requestRaw(baseUrl, imagePayload.image.url, { token: userA.token, expectedStatus: 404 });
  await requestRaw(baseUrl, imagePayload.image.url, { token: adminB.token, expectedStatus: 404 });

  console.log("[apiAuthz.test] ok");
} finally {
  if (serverProcess) serverProcess.kill("SIGTERM");
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}

async function login(baseUrl, email, password) {
  return requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

function buildSchedule(patch = {}) {
  return {
    siteName: "Test schedule",
    content: "権限テスト",
    date: "2026-05-28",
    endDate: "2026-05-28",
    startTime: "09:00",
    endTime: "10:00",
    members: [],
    memberIds: [],
    contractor: "",
    address: "",
    memo: "",
    memoImages: [],
    tagColor: "#3b82f6",
    tagColors: ["#3b82f6"],
    readBy: [],
    readByUserIds: [],
    ...patch,
  };
}

async function assertProductionCorsRequiresConfiguredOrigin(baseUrl) {
  const allowed = await fetch(`${baseUrl}/health`, {
    method: "OPTIONS",
    headers: { Origin: "http://allowed.example" },
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://allowed.example");

  const denied = await fetch(`${baseUrl}/health`, {
    method: "OPTIONS",
    headers: { Origin: "http://denied.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
}

async function assertForwardedForRateLimitCannotBeSpoofed(baseUrl) {
  const email = "rate-limit@example.test";
  const realClientIp = "203.0.113.10";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await requestJson(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email, password: "wrong-password" },
      headers: { "X-Forwarded-For": `198.51.100.${attempt}, ${realClientIp}` },
      expectedStatus: 401,
    });
  }

  await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password: "wrong-password" },
    headers: { "X-Forwarded-For": `198.51.100.250, ${realClientIp}` },
    expectedStatus: 429,
  });
}

async function requestJson(baseUrl, pathname, { method = "GET", token, body, headers, expectedStatus = 200 } = {}) {
  const response = await requestRaw(baseUrl, pathname, { method, token, body, headers, expectedStatus });
  return response.json();
}

async function requestRaw(baseUrl, pathname, { method = "GET", token, body, headers: rawHeaders, expectedStatus = 200 } = {}) {
  const headers = new Headers(rawHeaders);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, expectedStatus, `${method} ${pathname}`);
  return response;
}

async function startApiServer(port, tempDataDir) {
  const logFile = path.join(tempDataDir, "logs", "app.log");
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/Data/Server/server.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      CALENDAR_ALLOWED_ORIGINS: "http://allowed.example",
      CALENDAR_DATA_DIR: tempDataDir,
      CALENDAR_TRUST_PROXY: "1",
      LOG_FILE: logFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForHealth(port, child, () => stderr);
  return child;
}

async function waitForHealth(port, child, getStderr) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited early: ${getStderr()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`API server did not start: ${getStderr()}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
