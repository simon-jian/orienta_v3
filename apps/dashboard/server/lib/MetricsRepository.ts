/**
 * Persists client metrics events (P1-5), backed by the async SqlDb (P2-1).
 *
 * The browser SDK (public/orienta-metrics.js) batches events and POSTs them to
 * /api/metrics/events. Rows are pruned by the maintenance job.
 */
import type { SqlDb } from "../db/sqlDb";
import { autoIncrementPk } from "../db/sqlDb";

export type MetricEvent = {
  name: string;
  ts?: number;
  role?: string;
  category?: string;
  durationMs?: number;
  ok?: boolean;
  props?: Record<string, unknown>;
  /** Best-effort — older clients / static pages may not send one. See migrationList.ts. */
  tenantId?: string;
};

const MAX_NAME_LEN = 120;
const MAX_PROPS_BYTES = 2000;

export class MetricsRepository {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    // tenant_id is intentionally NOT in this CREATE TABLE: unlike a from-scratch
    // column, `ALTER TABLE ADD COLUMN` (used by the migration below) errors if
    // the column already exists, so it must be added exactly once, the same
    // way, for both a fresh database and a pre-existing one — see
    // migrationList.ts (2026_08_metrics_events_tenant_id), which always runs
    // after this init() regardless of whether the database is new or old.
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_events (
        id          ${autoIncrementPk(this.db.dialect)},
        name        TEXT NOT NULL,
        role        TEXT,
        category    TEXT,
        duration_ms REAL,
        ok          INTEGER,
        props       TEXT,
        created_at  BIGINT NOT NULL
      );
    `);
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics_events (created_at DESC);",
    );
  }

  /** Insert a validated batch atomically — either all rows land, or none do. */
  async insertBatch(events: MetricEvent[]): Promise<number> {
    const now = Date.now();
    return this.db.transaction(async (tx) => {
      let written = 0;
      for (const ev of events) {
        const name = String(ev?.name || "").slice(0, MAX_NAME_LEN);
        if (!name) continue;
        let props: string | null = null;
        if (ev.props && typeof ev.props === "object") {
          const s = JSON.stringify(ev.props);
          props = s.length > MAX_PROPS_BYTES ? s.slice(0, MAX_PROPS_BYTES) : s;
        }
        await tx.run(
          `INSERT INTO metrics_events (name, role, category, duration_ms, ok, props, created_at, tenant_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            name,
            ev.role ? String(ev.role).slice(0, 40) : null,
            ev.category ? String(ev.category).slice(0, 40) : null,
            typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs) ? ev.durationMs : null,
            typeof ev.ok === "boolean" ? (ev.ok ? 1 : 0) : null,
            props,
            // Client-controlled: clamp to a sane window so a bad/malicious ts can't
            // skew retention pruning (was previously accepted with no bound at all).
            typeof ev.ts === "number" && Number.isFinite(ev.ts) && Math.abs(ev.ts - now) < 24 * 60 * 60_000
              ? ev.ts
              : now,
            ev.tenantId ? String(ev.tenantId).slice(0, 60) : null,
          ],
        );
        written += 1;
      }
      return written;
    });
  }

  async pruneOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const r = await this.db.run("DELETE FROM metrics_events WHERE created_at < ?", [cutoff]);
    return r.changes;
  }
}
