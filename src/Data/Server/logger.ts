import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const defaultLogDir = new URL("../data/logs/", import.meta.url);
const logFile = process.env.LOG_FILE ?? join(process.env.CALENDAR_DATA_DIR ?? defaultLogDir.pathname, process.env.CALENDAR_DATA_DIR ? "logs/app.log" : "app.log");
const redactedValue = "[REDACTED]";
const circularValue = "[Circular]";
const maxLoggedStringLength = 4000;
const sensitiveKeyPattern = /(authorization|password|token)/i;
const bearerTokenPattern = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;

type LogLevel = "info" | "warn" | "error";

export function createRequestId() {
  return randomUUID();
}

export async function logInfo(message: string, fields: Record<string, unknown> = {}) {
  await writeLog("info", message, fields);
}

export async function logWarn(message: string, fields: Record<string, unknown> = {}) {
  await writeLog("warn", message, fields);
}

export async function logError(message: string, fields: Record<string, unknown> = {}) {
  await writeLog("error", message, fields);
}

function writeLog(level: LogLevel, message: string, fields: Record<string, unknown>) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...sanitizeFields(fields),
  };

  return appendLine(JSON.stringify(entry)).catch((error) => {
    console.error("failed to write log", error);
  });
}

async function appendLine(line: string) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${line}\n`);
}

function sanitizeFields(fields: Record<string, unknown>) {
  return sanitizeRecord(fields, new WeakSet<object>());
}

function sanitizeRecord(fields: Record<string, unknown>, seen: WeakSet<object>) {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value, seen);
  }

  return sanitized;
}

function sanitizeValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (sensitiveKeyPattern.test(key)) return redactedValue;
  if (typeof value === "string") return sanitizeString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return circularValue;

  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue("", item, seen));
  return sanitizeRecord(value as Record<string, unknown>, seen);
}

function sanitizeString(value: string) {
  const redacted = value.replace(bearerTokenPattern, `Bearer ${redactedValue}`);
  if (redacted.length <= maxLoggedStringLength) return redacted;
  return `${redacted.slice(0, maxLoggedStringLength)}...[truncated]`;
}
