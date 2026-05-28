import { spawn } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as pathTools from "node:path";

const moduleDir = new URL(".", import.meta.url);
const defaultDataDir = new URL("../data/", moduleDir);
const fs = fsPromises as typeof fsPromises & {
  copyFile: (source: string, target: string) => Promise<void>;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>>;
  stat: (path: string) => Promise<{ isFile: () => boolean }>;
};
const path = pathTools as typeof pathTools & {
  basename: (path: string) => string;
};
const runtimeProcess = process as unknown as {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number;
};

type BackupManifest = {
  createdAt: string;
  databasePath: string;
  backupDirectory: string;
  files: string[];
};

export async function runBackup() {
  const dataDir = getDataDir();
  const databasePath = getDatabasePath(dataDir);
  const backupDirectory = path.join(getBackupRoot(dataDir), getTimestamp());
  const backupDatabasePath = path.join(backupDirectory, path.basename(databasePath));
  const copiedFiles: string[] = [];

  await ensureFileExists(databasePath, "SQLite database");
  await fs.mkdir(backupDirectory, { recursive: true });
  await backupSqliteDatabase(databasePath, backupDatabasePath);
  await assertSqliteBackupIsReadable(backupDatabasePath);
  copiedFiles.push(...await listExistingDatabaseFiles(backupDatabasePath));

  for (const directoryName of ["memo-images", "logs"]) {
    const sourceDirectory = path.join(dataDir, directoryName);
    if (!(await pathExists(sourceDirectory))) continue;
    const targetDirectory = path.join(backupDirectory, directoryName);
    const copied = await copyDirectory(sourceDirectory, targetDirectory);
    copiedFiles.push(...copied);
  }

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    databasePath,
    backupDirectory,
    files: copiedFiles.map((file) => file.slice(backupDirectory.length + 1)),
  };
  await fs.writeFile(path.join(backupDirectory, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function main() {
  const manifest = await runBackup();
  console.info("[Backup.main] Backup completed", {
    backupDirectory: manifest.backupDirectory,
    fileCount: manifest.files.length,
  });
}

function getDataDir() {
  return runtimeProcess.env.CALENDAR_DATA_DIR ?? defaultDataDir.pathname;
}

function getDatabasePath(dataDir: string) {
  return runtimeProcess.env.DATABASE_PATH ?? path.join(dataDir, "calendar.sqlite");
}

function getBackupRoot(dataDir: string) {
  return runtimeProcess.env.CALENDAR_BACKUP_DIR ?? path.join(dataDir, "backups");
}

function getTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function backupSqliteDatabase(databasePath: string, backupPath: string) {
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await runSqlite(databasePath, `.timeout 5000\n.backup ${sqliteCliQuote(backupPath)}\n`);
}

async function assertSqliteBackupIsReadable(databasePath: string) {
  const output = await runSqlite(databasePath, ".timeout 5000\nPRAGMA quick_check;\n");
  if (output.trim() !== "ok") {
    throw new Error(`SQLite backup quick_check failed: ${output.trim() || "empty result"}`);
  }
}

function runSqlite(databasePath: string, input: string) {
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
    child.stdin.end(input);
  });
}

async function copyDirectory(sourceDirectory: string, targetDirectory: string): Promise<string[]> {
  await fs.mkdir(targetDirectory, { recursive: true });
  const copiedFiles: string[] = [];
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;

    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      copiedFiles.push(...await copyDirectory(sourcePath, targetPath));
      continue;
    }

    if (!entry.isFile()) continue;
    await fs.copyFile(sourcePath, targetPath);
    copiedFiles.push(targetPath);
  }

  return copiedFiles;
}

async function listExistingDatabaseFiles(databasePath: string) {
  const candidates = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  const existingPaths: string[] = [];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) existingPaths.push(candidate);
  }

  return existingPaths;
}

async function ensureFileExists(path: string, label: string) {
  try {
    const result = await fs.stat(path);
    if (result.isFile()) return;
  } catch {
    // The caller needs the same clear error whether the file is missing or inaccessible.
  }

  throw new Error(`${label} not found: ${path}`);
}

async function pathExists(path: string) {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function sqliteCliQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function isDirectRun() {
  const entryPath = runtimeProcess.argv[1];
  return Boolean(entryPath && import.meta.url === new URL(entryPath, "file://").href);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[Backup.main] Backup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    runtimeProcess.exitCode = 1;
  });
}
