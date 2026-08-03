import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { runMigrations } from "../db/migrations";
import { migrations } from "../db/migrationList";
import { MetricsRepository } from "./MetricsRepository";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
async function newRepo(): Promise<{ repo: MetricsRepository; db: SqlDb }> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-metrics-"));
  dirs.push(dir);
  const db = createSqliteDb(path.join(dir, "test.db"));
  dbs.push(db);
  const repo = new MetricsRepository(db);
  await repo.init();
  // Mirrors the real boot order (server.ts): init() creates the baseline
  // schema, then migrations bring it up to date (tenant_id column, etc.).
  await runMigrations(db, migrations);
  return { repo, db };
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

describe("MetricsRepository", () => {
  it("inserts valid events and skips nameless ones", async () => {
    const { repo } = await newRepo();
    const written = await repo.insertBatch([
      { name: "page.view", category: "nav", ok: true },
      { name: "", category: "nav" }, // skipped (no name)
      { name: "timer", durationMs: 42, props: { a: 1 }, tenantId: "airchina" },
    ]);
    expect(written).toBe(2);
  });

  it("stores the actual column values, not just a row count", async () => {
    const { repo, db } = await newRepo();
    await repo.insertBatch([
      { name: "timer", category: "nav", durationMs: 42, ok: true, props: { a: 1 }, tenantId: "airchina" },
    ]);
    const row = await db.get<{
      name: string; category: string; duration_ms: number; ok: number; props: string; tenant_id: string;
    }>("SELECT name, category, duration_ms, ok, props, tenant_id FROM metrics_events WHERE name = 'timer'");
    expect(row?.name).toBe("timer");
    expect(row?.category).toBe("nav");
    expect(row?.duration_ms).toBe(42);
    expect(row?.ok).toBe(1);
    expect(JSON.parse(row?.props ?? "{}")).toEqual({ a: 1 });
    expect(row?.tenant_id).toBe("airchina");
  });

  it("clamps a wildly out-of-range client-supplied ts instead of trusting it", async () => {
    const { repo, db } = await newRepo();
    const now = Date.now();
    await repo.insertBatch([{ name: "skewed", ts: now - 30 * 24 * 60 * 60_000 }]); // 30 days in the past
    const row = await db.get<{ created_at: number }>("SELECT created_at FROM metrics_events WHERE name = 'skewed'");
    // Clamped to "now" rather than the attacker/bug-controlled far-past value,
    // so a bad ts can't push a row outside the retention job's cutoff window.
    expect(Math.abs((row?.created_at ?? 0) - now)).toBeLessThan(5000);
  });

  it("prunes rows older than the cutoff", async () => {
    const { repo } = await newRepo();
    await repo.insertBatch([{ name: "old", ts: Date.now() - 1_000_000 }]);
    await repo.insertBatch([{ name: "fresh", ts: Date.now() }]);
    const removed = await repo.pruneOlderThan(60_000);
    expect(removed).toBe(1);
  });
});
