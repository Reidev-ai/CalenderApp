import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Database } from "./domain.ts";
import { defaultData } from "./defaultData.ts";

const dataDir = new URL("../data/", import.meta.url);
const dataFile = new URL("./db.json", dataDir);

export class JsonStore {
  private data: Database | null = null;

  async read(): Promise<Database> {
    if (this.data) return structuredClone(this.data);

    await mkdir(dataDir, { recursive: true });

    try {
      const file = await readFile(dataFile, "utf8");
      this.data = normalizeDatabase(JSON.parse(file));
    } catch {
      this.data = structuredClone(defaultData);
      await this.write(this.data);
    }

    return structuredClone(this.data);
  }

  async write(data: Database): Promise<Database> {
    this.data = normalizeDatabase(data);
    await mkdir(dataDir, { recursive: true });
    await writeFile(dataFile, `${JSON.stringify(this.data, null, 2)}\n`);
    return structuredClone(this.data);
  }

  async update(mutator: (data: Database) => void | Database): Promise<Database> {
    const data = await this.read();
    const next = mutator(data) ?? data;
    return this.write(next);
  }
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
