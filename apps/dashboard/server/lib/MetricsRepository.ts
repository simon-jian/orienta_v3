/**
 * Persists client metrics events to SQLite (P1-5).
 *
 * The browser SDK (public/orienta-metrics.js) batches events and POSTs them to
 * /api/metrics/events. This store gives that endpoint a real sink; rows are
 * pruned by the maintenance job (see jobs/maintenance.ts).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type MetricEvent = {
  name: string;
  ts?: number;
  role?: string;
  category?: string;
  durationMs?: number;
  ok?: boolean;
  props?: Record<string, unknown>;
};

const MAX_NAME_LEN = 120;
const MAX_PROPS_BYTES = 2000;

export class MetricsRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        role        TEXT,
        category    TEXT,
        duration_ms REAL,
        ok          INTEGER,
        props       TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics_events (created_at DESC);
    `);
  }

  /** Insert a validated batch in one transaction. Returns rows written. */
  insertBatch(events: MetricEvent[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO metrics_events (name, role, category, duration_ms, ok, props, created_at)
      VALUES (@name, @role, @category, @duration_ms, @ok, @props, @created_at)
    `);
    const now = Date.now();
    const insertMany = this.db.transaction((rows: MetricEvent[]) => {
      let n = 0;
      for (const ev of rows) {
        const name = String(ev?.name || "").slice(0, MAX_NAME_LEN);
        if (!name) continue;
        let props: string | null = null;
        if (ev.props && typeof ev.props === "object") {
          const s = JSON.stringify(ev.props);
          props = s.length > MAX_PROPS_BYTES ? s.slice(0, MAX_PROPS_BYTES) : s;
        }
        stmt.run({
          name,
          role: ev.role ? String(ev.role).slice(0, 40) : null,
          category: ev.category ? String(ev.category).slice(0, 40) : null,
          duration_ms: typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs) ? ev.durationMs : null,
          ok: typeof ev.ok === "boolean" ? (ev.ok ? 1 : 0) : null,
          props,
          created_at: typeof ev.ts === "number" && Number.isFinite(ev.ts) ? ev.ts : now,
        });
        n += 1;
      }
      return n;
    });
    return insertMany(events);
  }

  pruneOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    return this.db.prepare("DELETE FROM metrics_events WHERE created_at < ?").run(cutoff).changes;
  }
}
