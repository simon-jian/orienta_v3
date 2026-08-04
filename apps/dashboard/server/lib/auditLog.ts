/**
 * Admin/passenger audit log — records security-sensitive actions (P1-4),
 * backed by the async SqlDb (P2-1).
 *
 * `record()` is fire-and-forget friendly: it never rejects, so callers may
 * `void auditLog.record(...)` without awaiting.
 */
import type { SqlDb } from "./../db/sqlDb";
import { autoIncrementPk } from "./../db/sqlDb";
import { logger } from "./logger";

export type AuditEvent = {
  actorEmail: string;
  action: string;
  tenantId?: string;
  passengerId?: string;
  detail?: string;
};

export class AuditLog {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id            ${autoIncrementPk(this.db.dialect)},
        actor_email   TEXT NOT NULL,
        action        TEXT NOT NULL,
        tenant_id     TEXT,
        passenger_id  TEXT,
        detail        TEXT,
        created_at    BIGINT NOT NULL
      );
    `);
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);",
    );
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_admin_audit_passenger ON admin_audit_log (tenant_id, passenger_id, created_at DESC);",
    );
  }

  /** Removes audit rows older than maxAgeMs. Returns the number of rows deleted. */
  async pruneOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const r = await this.db.run("DELETE FROM admin_audit_log WHERE created_at < ?", [cutoff]);
    return r.changes;
  }

  /** Audit entries recorded against one passenger (passenger_create/update/delete/session events). Used by the data-export endpoint. */
  async listForPassenger(tenantId: string, passengerId: string, limit = 200): Promise<
    { actorEmail: string; action: string; detail: string | null; createdAt: number }[]
  > {
    const rows = await this.db.all<{ actor_email: string; action: string; detail: string | null; created_at: number }>(
      `SELECT actor_email, action, detail, created_at FROM admin_audit_log
       WHERE tenant_id = ? AND passenger_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [tenantId, passengerId, limit],
    );
    return rows.map((r) => ({ actorEmail: r.actor_email, action: r.action, detail: r.detail, createdAt: r.created_at }));
  }

  async record(event: AuditEvent): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO admin_audit_log (actor_email, action, tenant_id, passenger_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          event.actorEmail,
          event.action,
          event.tenantId ?? null,
          event.passengerId ?? null,
          event.detail ?? null,
          Date.now(),
        ],
      );
    } catch (err) {
      logger.error("audit_write_failed", {
        action: event.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
