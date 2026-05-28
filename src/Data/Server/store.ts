import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "./domain.ts";
import { defaultData } from "./defaultData.ts";

const moduleDir = new URL(".", import.meta.url);
const legacyDataFile = new URL("../data/db.json", moduleDir);
const defaultDataDir = new URL("../data/", moduleDir);

const collectionNames = [
  "users",
  "groups",
  "joinRequests",
  "sessions",
  "schedules",
  "trashSchedules",
  "tags",
] as const;

type CollectionName = typeof collectionNames[number];

export class SqliteStore {
  private initialized = false;
  private databasePath: string;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(databasePath = getDatabasePath()) {
    this.databasePath = databasePath;
  }

  async read(): Promise<Database> {
    return this.enqueue(() => this.readUnlocked());
  }

  async write(data: Database): Promise<Database> {
    return this.enqueue(() => this.writeUnlocked(data));
  }

  async update(mutator: (data: Database) => void | Database): Promise<Database> {
    return this.enqueue(async () => {
      const data = await this.readUnlocked();
      const next = mutator(data) ?? data;
      return this.writeUnlocked(next);
    });
  }

  private async readUnlocked(): Promise<Database> {
    await this.ensureInitialized();
    const rows = await this.queryRows("SELECT collection, payload FROM records ORDER BY collection, id;");
    const database = emptyDatabase();

    for (const row of rows) {
      const collection = row.collection as CollectionName;
      if (!isCollectionName(collection)) continue;
      database[collection].push(JSON.parse(row.payload));
    }

    return structuredClone(database);
  }

  private async writeUnlocked(data: Database): Promise<Database> {
    await this.ensureInitialized();
    const normalized = normalizeDatabase(data);
    await runSql(this.databasePath, buildWriteSql(normalized));
    return structuredClone(normalized);
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    await runSql(this.databasePath, `.timeout 5000
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection, id)
);
`);

    const countRows = await this.queryRows("SELECT COUNT(*) AS count FROM records;");
    const count = Number(countRows[0]?.count ?? 0);
    this.initialized = true;
    if (count === 0) {
      await this.writeUnlocked(await loadInitialData());
    }
  }

  private async queryRows(sql: string) {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const output = await runSql(this.databasePath, `.timeout 5000\n.mode json\n${sql}`);
    if (!output.trim()) return [] as Record<string, string>[];
    return JSON.parse(output) as Record<string, string>[];
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch(() => undefined);
    return next;
  }
}

export const JsonStore = SqliteStore;

async function loadInitialData(): Promise<Database> {
  if (process.env.CALENDAR_SEED_DATA !== "1") {
    return emptyDatabase();
  }

  try {
    const file = await readFile(legacyDataFile, "utf8");
    return normalizeDatabase(JSON.parse(file));
  } catch {
    return structuredClone(defaultData);
  }
}

function getDatabasePath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const dataDir = process.env.CALENDAR_DATA_DIR ?? defaultDataDir.pathname;
  return join(dataDir, "calendar.sqlite");
}

function emptyDatabase(): Database {
  return {
    users: [],
    groups: [],
    joinRequests: [],
    sessions: [],
    schedules: [],
    trashSchedules: [],
    tags: [],
  };
}

function normalizeDatabase(input: Partial<Database>): Database {
  return {
    users: input.users ?? [],
    groups: input.groups ?? [],
    joinRequests: input.joinRequests ?? [],
    sessions: input.sessions ?? [],
    schedules: input.schedules ?? [],
    trashSchedules: input.trashSchedules ?? [],
    tags: input.tags ?? [],
  };
}

function buildWriteSql(data: Database) {
  const statements = [
    ".timeout 5000",
    "BEGIN IMMEDIATE;",
    "DELETE FROM records;",
  ];

  for (const collection of collectionNames) {
    for (const item of data[collection]) {
      const id = typeof item === "object" && item && "id" in item ? String(item.id) : randomUUID();
      statements.push(`INSERT INTO records (collection, id, payload, updated_at) VALUES (${sqlString(collection)}, ${sqlString(id)}, ${sqlString(JSON.stringify(item))}, CURRENT_TIMESTAMP);`);
    }
  }

  statements.push("COMMIT;");
  return statements.join("\n");
}

function isCollectionName(value: string): value is CollectionName {
  return collectionNames.includes(value as CollectionName);
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(databasePath: string, sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("sqlite3", [databasePath], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];

    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8") || `sqlite3 exited with code ${code}`));
    });
    child.stdin.end(sql);
  });
}
