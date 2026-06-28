/**
 * Persists chat messages to SQLite (same database file as passenger registry).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../../src/types/types";

export class ChatRepository {
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
      CREATE TABLE IF NOT EXISTS chat_messages (
        id            TEXT NOT NULL,
        tenant_id     TEXT NOT NULL,
        passenger_id  TEXT NOT NULL,
        sender        TEXT NOT NULL,
        kind          TEXT NOT NULL,
        body          TEXT NOT NULL,
        gate_ref      TEXT,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (id)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_pax
        ON chat_messages (tenant_id, passenger_id, created_at);
    `);
  }

  append(tenantId: string, passengerId: string, message: ChatMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO chat_messages
        (id, tenant_id, passenger_id, sender, kind, body, gate_ref, created_at)
      VALUES
        (@id, @tenant_id, @passenger_id, @sender, @kind, @body, @gate_ref, @created_at)
    `).run({
      id: message.id,
      tenant_id: tenantId,
      passenger_id: passengerId,
      sender: message.from,
      kind: message.kind,
      body: message.body,
      gate_ref: message.gateRef ?? null,
      created_at: message.createdAt,
    });
  }

  loadRecent(tenantId: string, passengerId: string, limit = 100): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT id, sender, kind, body, gate_ref, created_at
      FROM chat_messages
      WHERE tenant_id = ? AND passenger_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, passengerId, limit) as Array<{
      id: string;
      sender: string;
      kind: string;
      body: string;
      gate_ref: string | null;
      created_at: number;
    }>;
    return rows.reverse().map((row) => ({
      id: row.id,
      passengerId,
      tenantId,
      from: row.sender as ChatMessage["from"],
      kind: row.kind as ChatMessage["kind"],
      body: row.body,
      gateRef: row.gate_ref ?? undefined,
      createdAt: row.created_at,
    }));
  }

  pruneOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare("DELETE FROM chat_messages WHERE created_at < ?").run(cutoff);
    return result.changes;
  }

  /** Lightweight liveness probe for GET /health. Throws if the DB is unreachable. */
  ping(): boolean {
    const row = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return row?.ok === 1;
  }
}
