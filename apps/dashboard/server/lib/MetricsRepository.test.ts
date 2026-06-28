import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb } from "../db/sqlDb";
import { MetricsRepository } from "./MetricsRepository";

const dirs: string[] = [];
async function newRepo(): Promise<MetricsRepository> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-metrics-"));
  dirs.push(dir);
  const repo = new MetricsRepository(createSqliteDb(path.join(dir, "test.db")));
  await repo.init();
  return repo;
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("MetricsRepository", () => {
  it("inserts valid events and skips nameless ones", async () => {
    const repo = await newRepo();
    const written = await repo.insertBatch([
      { name: "page.view", category: "nav", ok: true },
      { name: "", category: "nav" }, // skipped (no name)
      { name: "timer", durationMs: 42, props: { a: 1 } },
    ]);
    expect(written).toBe(2);
  });

  it("prunes rows older than the cutoff", async () => {
    const repo = await newRepo();
    await repo.insertBatch([{ name: "old", ts: Date.now() - 1_000_000 }]);
    await repo.insertBatch([{ name: "fresh", ts: Date.now() }]);
    const removed = await repo.pruneOlderThan(60_000);
    expect(removed).toBe(1);
  });
});
