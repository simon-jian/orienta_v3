import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PushSubscriptionStore } from "./PushSubscriptionStore";

const dirs: string[] = [];
function newStore(): { store: PushSubscriptionStore; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-push-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "test.db");
  return { store: new PushSubscriptionStore(dbPath), dbPath };
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("PushSubscriptionStore", () => {
  it("upserts (dedupes by endpoint) and lists by key", () => {
    const { store } = newStore();
    store.upsert("airchina::TX1", { endpoint: "https://push/a", keys: { p256dh: "p", auth: "a" } });
    store.upsert("airchina::TX1", { endpoint: "https://push/b" });
    store.upsert("airchina::TX1", { endpoint: "https://push/a", keys: { p256dh: "p2", auth: "a2" } }); // update

    const subs = store.list("airchina::TX1");
    expect(subs).toHaveLength(2);
    const a = subs.find((s) => s.endpoint === "https://push/a")!;
    expect(a.keys?.p256dh).toBe("p2");
  });

  it("removes a dead endpoint and isolates keys", () => {
    const { store } = newStore();
    store.upsert("airchina::TX1", { endpoint: "https://push/a" });
    store.upsert("airchina::TX2", { endpoint: "https://push/c" });
    store.removeEndpoint("airchina::TX1", "https://push/a");
    expect(store.list("airchina::TX1")).toHaveLength(0);
    expect(store.list("airchina::TX2")).toHaveLength(1);
  });

  it("persists across store instances (survives restart)", () => {
    const { store, dbPath } = newStore();
    store.upsert("airchina::TX1", { endpoint: "https://push/a" });
    const reopened = new PushSubscriptionStore(dbPath);
    expect(reopened.list("airchina::TX1")).toHaveLength(1);
  });
});
