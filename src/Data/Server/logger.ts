import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const defaultLogDir = new URL("../data/logs/", import.meta.url);
const logFile = process.env.LOG_FILE ?? join(process.env.CALENDAR_DATA_DIR ?? defaultLogDir.pathname, process.env.CALENDAR_DATA_DIR ? "logs/app.log" : "app.log");

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
  const sanitized = { ...fields };
  delete sanitized.password;
  delete sanitized.passwordHash;
  delete sanitized.token;
  delete sanitized.authorization;
  return sanitized;
}
