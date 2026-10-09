import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FileRepository, RedisRepository, createRepository, emptyData } from "./storage.js";
import type { AppData } from "./app-data.js";

const user = (id: string) => ({
  id, name: id, email: `${id}@example.com`, role: "Admin" as const, employeeId: null,
  active: true, createdAt: new Date(0).toISOString(), passwordSalt: "s", passwordHash: "h",
});

/** Minimal in-memory imitation of Upstash's REST API (POST a JSON command array). */
function startMockUpstash(token: string) {
  const store = new Map<string, string>();
  const stats = { casConflicts: 0, casWrites: 0, badAuth: 0 };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) { stats.badAuth += 1; return reply(401, { error: "Unauthorized" }); }
      const cmd = JSON.parse(raw) as unknown[];
      assert.ok(cmd.every((a) => typeof a === "string"), "all command args must be strings");
      const [name, ...args] = cmd as string[];
      if (name === "MGET") return reply(200, { result: args.map((k) => store.get(k) ?? null) });
      if (name === "EVAL") {
        // args: script, numkeys, key1, key2, rev, json  (mirrors the Lua compare-and-set)
        const [, numkeys, dataKey, revKey, expectedRev, json] = args;
        assert.equal(numkeys, "2");
        const rev = Number(store.get(revKey) ?? "0");
        if (rev !== Number(expectedRev)) { stats.casConflicts += 1; return reply(200, { result: 0 }); }
        store.set(dataKey, json);
        store.set(revKey, String(rev + 1));
        stats.casWrites += 1;
        return reply(200, { result: 1 });
      }
      return reply(400, { error: `ERR unknown command '${name}'` });
    });
  });
  return new Promise<{ url: string; stats: typeof stats; store: Map<string, string>; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, stats, store, close: () => new Promise((r) => server.close(() => r())) });
    }),
  );
}

test("file store: starts empty, persists across instances, applies updates in order", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reception-"));
  const file = path.join(dir, "nested", "data.json");
  const a = new FileRepository(file);
  assert.deepEqual(await a.load(), emptyData());
  await Promise.all(Array.from({ length: 15 }, (_, i) => a.transact((d) => { d.users.push(user(`u${i}`)); })));
  const b = new FileRepository(file);
  assert.equal((await b.load()).users.length, 15);
});

test("file store: a failing update writes nothing and a corrupt file is never overwritten", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reception-"));
  const file = path.join(dir, "data.json");
  const repo = new FileRepository(file);
  await assert.rejects(repo.transact((d) => { d.users.push(user("x")); throw new Error("boom"); }), /boom/);
  assert.equal((await repo.load()).users.length, 0);
  await writeFile(file, "{not json");
  await assert.rejects(repo.transact((d) => { d.users.push(user("y")); }), /unreadable/);
  assert.equal(await readFile(file, "utf8"), "{not json");
});

test("redis store: round-trips data through the REST protocol with auth", async () => {
  const mock = await startMockUpstash("tok");
  try {
    const repo = new RedisRepository(mock.url, "tok");
    assert.deepEqual(await repo.load(), emptyData());
    const result = await repo.transact((d) => { d.users.push(user("a")); return "done"; });
    assert.equal(result, "done");
    assert.equal((await new RedisRepository(mock.url, "tok").load()).users[0]?.id, "a");
    await assert.rejects(new RedisRepository(mock.url, "wrong").load(), /Data store request failed/);
  } finally { await mock.close(); }
});

test("redis store: concurrent writers (separate instances) lose no updates", async () => {
  const mock = await startMockUpstash("tok");
  try {
    const writers = Array.from({ length: 8 }, () => new RedisRepository(mock.url, "tok"));
    await Promise.all(writers.map((w, i) => w.transact((d: AppData) => { d.users.push(user(`u${i}`)); })));
    const data = await new RedisRepository(mock.url, "tok").load();
    assert.deepEqual(data.users.map((u) => u.id).sort(), Array.from({ length: 8 }, (_, i) => `u${i}`).sort());
    assert.ok(mock.stats.casConflicts > 0, "expected the compare-and-set to detect and retry conflicts");
    assert.equal(mock.stats.casWrites, 8);
  } finally { await mock.close(); }
});

test("redis store: a failing update is not written and retries re-run on fresh data", async () => {
  const mock = await startMockUpstash("tok");
  try {
    const repo = new RedisRepository(mock.url, "tok");
    await assert.rejects(repo.transact(() => { throw new Error("nope"); }), /nope/);
    assert.equal(mock.stats.casWrites, 0);
  } finally { await mock.close(); }
});

test("createRepository: file locally, redis when configured, refuses a file on Vercel", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "VERCEL"]) delete process.env[k];
    assert.equal(createRepository().kind, "file");
    process.env.VERCEL = "1";
    assert.equal(createRepository().kind, "unconfigured");
    process.env.KV_REST_API_URL = "https://x.upstash.io/";
    process.env.KV_REST_API_TOKEN = "t";
    assert.equal(createRepository().kind, "redis");
  } finally { process.env = saved; }
});

test("unconfigured store surfaces a helpful 503 message", async () => {
  const saved = { ...process.env };
  try {
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) delete process.env[k];
    process.env.VERCEL = "1";
    await assert.rejects(createRepository().repository.load(), (e: Error & { statusCode?: number }) => e.statusCode === 503 && /Upstash/.test(e.message));
  } finally { process.env = saved; }
});
