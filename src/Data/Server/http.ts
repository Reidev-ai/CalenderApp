import type { IncomingMessage, ServerResponse } from "node:http";

const defaultAllowedOriginPatterns = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^http:\/\/0\.0\.0\.0(?::\d+)?$/,
  /^http:\/\/10\.\d+\.\d+\.\d+(?::\d+)?$/,
  /^http:\/\/192\.168\.\d+\.\d+(?::\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(?::\d+)?$/,
  /^http:\/\/100\.\d+\.\d+\.\d+(?::\d+)?$/,
];

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function parseJsonBody<T>(req: IncomingMessage, options: { maxBytes?: number } = {}): Promise<T> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (options.maxBytes !== undefined && size > options.maxBytes) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(bytes);
  }

  if (chunks.length === 0) return {} as T;

  const raw = new TextDecoder().decode(concatChunks(chunks));
  if (!raw.trim()) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown, origin?: string | string[]) {
  res.writeHead(status, {
    ...buildCorsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

export function sendNoContent(res: ServerResponse, origin?: string | string[]) {
  res.writeHead(204, {
    ...buildCorsHeaders(origin),
  });
  res.end();
}

export function notFound(pathname: string): never {
  throw new HttpError(404, `Route not found: ${pathname}`);
}

function concatChunks(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

export function buildCorsHeaders(origin?: string | string[]) {
  const allowedOrigin = getAllowedOrigin(Array.isArray(origin) ? origin[0] : origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin",
  };

  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

function getAllowedOrigin(origin?: string) {
  if (!origin) return undefined;
  const configuredOrigins = getConfiguredOrigins();
  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin) ? origin : undefined;
  }

  return defaultAllowedOriginPatterns.some((pattern) => pattern.test(origin)) ? origin : undefined;
}

function getConfiguredOrigins() {
  return (process.env.CALENDAR_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
