/**
 * Admin audit log — records security-sensitive operator actions.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type AuditEvent = {
  actorEmail: string;
  action: string;
  tenantId?: string;
  passengerId?: string;
  detail?: string;
};

export class AuditLog {
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
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_email   TEXT NOT NULL,
        action        TEXT NOT NULL,
        tenant_id     TEXT,
        passenger_id  TEXT,
        detail        TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created
        ON admin_audit_log (created_at DESC);
    `);
  }

  record(event: AuditEvent): void {
    this.db.prepare(`
      INSERT INTO admin_audit_log (actor_email, action, tenant_id, passenger_id, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.actorEmail,
      event.action,
      event.tenantId ?? null,
      event.passengerId ?? null,
      event.detail ?? null,
      Date.now(),
    );
  }
}
