import { runBackup } from "./backup.ts";

const runtimeProcess = process as unknown as {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number;
};
const defaultIntervalMinutes = 24 * 60;
let backupRunning = false;

async function main() {
  if (runtimeProcess.env.CALENDAR_BACKUP_ENABLED !== "1") {
    console.info("[BackupScheduler.main] Periodic backup is disabled", {
      enableWith: "CALENDAR_BACKUP_ENABLED=1",
    });
    return;
  }

  const intervalMinutes = getPositiveNumber(runtimeProcess.env.CALENDAR_BACKUP_INTERVAL_MINUTES, defaultIntervalMinutes);
  const intervalMs = intervalMinutes * 60 * 1000;

  console.info("[BackupScheduler.main] Periodic backup started", {
    intervalMinutes,
    runOnStart: runtimeProcess.env.CALENDAR_BACKUP_RUN_ON_START === "1",
  });

  if (runtimeProcess.env.CALENDAR_BACKUP_RUN_ON_START === "1") {
    await runScheduledBackup();
  }

  setInterval(() => {
    void runScheduledBackup();
  }, intervalMs);
}

async function runScheduledBackup() {
  if (backupRunning) {
    console.warn("[BackupScheduler.runScheduledBackup] Previous backup is still running; skip this tick");
    return;
  }

  backupRunning = true;
  try {
    const manifest = await runBackup();
    console.info("[BackupScheduler.runScheduledBackup] Backup completed", {
      backupDirectory: manifest.backupDirectory,
      fileCount: manifest.files.length,
    });
  } catch (error) {
    console.error("[BackupScheduler.runScheduledBackup] Backup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    backupRunning = false;
  }
}

function getPositiveNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isDirectRun() {
  const entryPath = runtimeProcess.argv[1];
  return Boolean(entryPath && import.meta.url === new URL(entryPath, "file://").href);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[BackupScheduler.main] Unexpected scheduler failure", {
      error: error instanceof Error ? error.message : String(error),
    });
    runtimeProcess.exitCode = 1;
  });
}
