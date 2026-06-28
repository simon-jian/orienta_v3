import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MetricsRepository } from "./MetricsRepository";

const dirs: string[] = [];
function newRepo(): MetricsRepository {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-metrics-"));
  dirs.push(dir);
  return new MetricsRepository(path.join(dir, "test.db"));
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("MetricsRepository", () => {
  it("inserts valid events and skips nameless ones", () => {
    const repo = newRepo();
    const written = repo.insertBatch([
      { name: "page.view", category: "nav", ok: true },
      { name: "", category: "nav" }, // skipped (no name)
      { name: "timer", durationMs: 42, props: { a: 1 } },
    ]);
    expect(written).toBe(2);
  });

  it("prunes rows older than the cutoff", () => {
    const repo = newRepo();
    repo.insertBatch([{ name: "old", ts: Date.now() - 1_000_000 }]);
    repo.insertBatch([{ name: "fresh", ts: Date.now() }]);
    const removed = repo.pruneOlderThan(60_000);
    expect(removed).toBe(1);
  });
});
