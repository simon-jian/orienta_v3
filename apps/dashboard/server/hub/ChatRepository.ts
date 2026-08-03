/**
 * Persists chat messages, backed by the async SqlDb (P2-1).
 */
import type { SqlDb } from "../db/sqlDb";
import type { ChatMessage } from "../../src/types/types";

type Row = {
  id: string;
  sender: string;
  kind: string;
  body: string;
  gate_ref: string | null;
  created_at: number;
};

export class ChatRepository {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id            TEXT NOT NULL,
        tenant_id     TEXT NOT NULL,
        passenger_id  TEXT NOT NULL,
        sender        TEXT NOT NULL,
        kind          TEXT NOT NULL,
        body          TEXT NOT NULL,
        gate_ref      TEXT,
        created_at    BIGINT NOT NULL,
        PRIMARY KEY (id)
      );
    `);
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_pax
        ON chat_messages (tenant_id, passenger_id, created_at);
    `);
  }

  async append(tenantId: string, passengerId: string, message: ChatMessage): Promise<void> {
    await this.db.run(
      `INSERT INTO chat_messages
         (id, tenant_id, passenger_id, sender, kind, body, gate_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         sender = excluded.sender,
         kind = excluded.kind,
         body = excluded.body,
         gate_ref = excluded.gate_ref,
         created_at = excluded.created_at`,
      [
        message.id,
        tenantId,
        passengerId,
        message.from,
        message.kind,
        message.body,
        message.gateRef ?? null,
        message.createdAt,
      ],
    );
  }

  async loadRecent(tenantId: string, passengerId: string, limit = 100): Promise<ChatMessage[]> {
    const rows = await this.db.all<Row>(
      `SELECT id, sender, kind, body, gate_ref, created_at
       FROM chat_messages
       WHERE tenant_id = ? AND passenger_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [tenantId, passengerId, limit],
    );
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

  async pruneOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const r = await this.db.run("DELETE FROM chat_messages WHERE created_at < ?", [cutoff]);
    return r.changes;
  }

  /** Removes all chat history for one passenger — used when the passenger itself is deleted. */
  async deleteForPassenger(tenantId: string, passengerId: string): Promise<number> {
    const r = await this.db.run(
      "DELETE FROM chat_messages WHERE tenant_id = ? AND passenger_id = ?",
      [tenantId, passengerId],
    );
    return r.changes;
  }

  /** Lightweight liveness probe for GET /health. */
  async ping(): Promise<boolean> {
    return this.db.ping();
  }
}
