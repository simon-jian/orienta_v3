import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { PushSubscriptionStore } from "./PushSubscriptionStore";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
function trackDb(dbPath: string): SqlDb {
  const db = createSqliteDb(dbPath);
  dbs.push(db);
  return db;
}
async function newStore(): Promise<{ store: PushSubscriptionStore; dbPath: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-push-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "test.db");
  const store = new PushSubscriptionStore(trackDb(dbPath));
  await store.init();
  return { store, dbPath };
}

// Close DB handles before deleting temp dirs — leaving better-sqlite3
// connections open can stop vitest's worker pool from exiting cleanly.
afterEach(async () => {
  while (dbs.length) {
    try { await dbs.pop()!.close(); } catch { /* ignore */ }
  }
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("PushSubscriptionStore", () => {
  it("upserts (dedupes by endpoint) and lists by key", async () => {
    const { store } = await newStore();
    await store.upsert("airchina::TX1", { endpoint: "https://push/a", keys: { p256dh: "p", auth: "a" } });
    await store.upsert("airchina::TX1", { endpoint: "https://push/b" });
    await store.upsert("airchina::TX1", { endpoint: "https://push/a", keys: { p256dh: "p2", auth: "a2" } }); // update

    const subs = await store.list("airchina::TX1");
    expect(subs).toHaveLength(2);
    const a = subs.find((s) => s.endpoint === "https://push/a")!;
    expect(a.keys?.p256dh).toBe("p2");
  });

  it("removes a dead endpoint and isolates keys", async () => {
    const { store } = await newStore();
    await store.upsert("airchina::TX1", { endpoint: "https://push/a" });
    await store.upsert("airchina::TX2", { endpoint: "https://push/c" });
    await store.removeEndpoint("airchina::TX1", "https://push/a");
    expect(await store.list("airchina::TX1")).toHaveLength(0);
    expect(await store.list("airchina::TX2")).toHaveLength(1);
  });

  it("persists across store instances (survives restart)", async () => {
    const { store, dbPath } = await newStore();
    await store.upsert("airchina::TX1", { endpoint: "https://push/a" });
    const reopened = new PushSubscriptionStore(trackDb(dbPath));
    await reopened.init();
    expect(await reopened.list("airchina::TX1")).toHaveLength(1);
  });
});
