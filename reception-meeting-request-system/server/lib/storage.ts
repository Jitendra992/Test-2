import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AppData, AppDataRepository } from "./app-data.js";
import { redisConfig } from "./config.js";
import { HttpError } from "./errors.js";

export function emptyData(): AppData {
  return {
    version: 1,
    users: [],
    sessions: [],
    employees: [],
    requests: [],
    localMigrationComplete: false,
  };
}

export function validateData(value: unknown, source: string): AppData {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("users" in value) ||
    !Array.isArray(value.users) ||
    !("sessions" in value) ||
    !Array.isArray(value.sessions) ||
    !("employees" in value) ||
    !Array.isArray(value.employees) ||
    !("requests" in value) ||
    !Array.isArray(value.requests) ||
    !("localMigrationComplete" in value) ||
    typeof value.localMigrationComplete !== "boolean"
  ) {
    throw new Error(`Reception data in ${source} has an unsupported or invalid format. It was not overwritten.`);
  }
  return value as AppData;
}

/* ------------------------------------------------------------------ */
/* Local JSON file (default for `npm run dev`; needs no setup)         */
/* ------------------------------------------------------------------ */

export class FileRepository implements AppDataRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  load = async (): Promise<AppData> => {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return validateData(JSON.parse(raw) as unknown, `"${this.filePath}"`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      if (error instanceof SyntaxError) {
        throw new Error(`Reception data file "${this.filePath}" is unreadable. It was not overwritten.`);
      }
      throw error;
    }
  };

  private async persist(data: AppData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  transact = <T>(update: (data: AppData) => T | Promise<T>): Promise<T> => {
    const operation = this.writeQueue.then(async () => {
      const data = await this.load();
      const result = await update(data);
      await this.persist(data);
      return result;
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}

/* ------------------------------------------------------------------ */
/* Hosted Redis over REST (Upstash) for serverless hosts like Vercel   */
/* ------------------------------------------------------------------ */

const DATA_KEY = "reception:data";
const REV_KEY = "reception:rev";
const MAX_ATTEMPTS = 10;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Compare-and-set: only write when nobody else has written since we read.
const CAS_SCRIPT = `
local rev = tonumber(redis.call('GET', KEYS[2]) or '0')
if rev ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(rev + 1))
return 1
`;

export class RedisRepository implements AppDataRepository {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.map(String)),
    });
    const body = (await response.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!response.ok || !body || body.error) {
      throw new Error(`Data store request failed (${body?.error ?? response.status}).`);
    }
    return body.result as T;
  }

  private async read(): Promise<{ data: AppData; rev: number }> {
    const [raw, rev] = await this.command<[string | null, string | null]>("MGET", DATA_KEY, REV_KEY);
    return {
      data: raw ? validateData(JSON.parse(raw) as unknown, "the connected Redis store") : emptyData(),
      rev: rev ? Number(rev) : 0,
    };
  }

  load = async (): Promise<AppData> => (await this.read()).data;

  transact = async <T>(update: (data: AppData) => T | Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const { data, rev } = await this.read();
      const result = await update(data);
      const written = await this.command<number>(
        "EVAL", CAS_SCRIPT, 2, DATA_KEY, REV_KEY, rev, JSON.stringify(data),
      );
      if (written === 1) return result;
      // Someone else wrote first: back off briefly (jittered) and retry on fresh data.
      await sleep(5 + Math.random() * 25 * (attempt + 1));
    }
    throw new HttpError(503, "The data store is busy. Please try again.");
  };
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

const NOT_CONFIGURED =
  "No database is connected. In Vercel open Storage, create an Upstash Redis database, " +
  "connect it to this project, then redeploy. See README.md.";

const unconfigured: AppDataRepository = {
  load: () => Promise.reject(new HttpError(503, NOT_CONFIGURED)),
  transact: () => Promise.reject(new HttpError(503, NOT_CONFIGURED)),
};

export type StorageKind = "redis" | "file" | "unconfigured";

export function createRepository(): { repository: AppDataRepository; kind: StorageKind; description: string } {
  const redis = redisConfig();
  if (redis) {
    return { repository: new RedisRepository(redis.url, redis.token), kind: "redis", description: "Redis (REST)" };
  }
  // Serverless hosts have a read-only / ephemeral filesystem, so never fall back to a file there.
  if (process.env.VERCEL) return { repository: unconfigured, kind: "unconfigured", description: "not configured" };
  const filePath = path.resolve(process.env.RECEPTION_DATA_FILE || path.join(process.cwd(), ".data", "reception.json"));
  return { repository: new FileRepository(filePath), kind: "file", description: filePath };
}
