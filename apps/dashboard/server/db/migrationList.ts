/**
 * The ordered list of migrations run at boot (server.ts, after every store's
 * own `init()`). Append new migrations to the end — never edit or reorder an
 * already-shipped entry, since its `id` has likely already been recorded in
 * `schema_migrations` on real databases.
 */
import type { SqlDb } from "./sqlDb";
import type { Migration } from "./migrations";

/**
 * True when `table` exists. Migrations that reshape a specific store's table
 * check this first — a database (or, in tests, an isolated single-store
 * fixture) that never had that store's `init()` run has no such table yet,
 * and nothing to migrate: whenever that store's `init()` does eventually run,
 * it creates the table with the current (already-migrated) baseline shape
 * directly.
 */
async function tableExists(db: SqlDb, table: string): Promise<boolean> {
  if (db.dialect === "pg") {
    const row = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ?) AS exists",
      [table],
    );
    return !!row?.exists;
  }
  const row = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return !!row;
}

export const migrations: Migration[] = [
  {
    // chat_messages was keyed by a bare `id` (assumed globally unique, e.g. a
    // UUID). Its `ON CONFLICT (id) DO UPDATE` upsert meant a colliding id
    // across two different tenants silently overwrote the other tenant's
    // message. SQLite has no `ALTER TABLE ... DROP CONSTRAINT`, so widening a
    // primary key means recreate + copy + swap, done identically on both
    // dialects for consistency.
    id: "2026_08_chat_messages_composite_pk",
    up: async (db) => {
      if (!(await tableExists(db, "chat_messages"))) return;
      await db.exec("ALTER TABLE chat_messages RENAME TO chat_messages_pre_composite_pk");
      await db.exec(`
        CREATE TABLE chat_messages (
          id            TEXT NOT NULL,
          tenant_id     TEXT NOT NULL,
          passenger_id  TEXT NOT NULL,
          sender        TEXT NOT NULL,
          kind          TEXT NOT NULL,
          body          TEXT NOT NULL,
          gate_ref      TEXT,
          created_at    BIGINT NOT NULL,
          PRIMARY KEY (tenant_id, id)
        );
      `);
      await db.exec(`
        INSERT INTO chat_messages (id, tenant_id, passenger_id, sender, kind, body, gate_ref, created_at)
        SELECT id, tenant_id, passenger_id, sender, kind, body, gate_ref, created_at
        FROM chat_messages_pre_composite_pk
      `);
      await db.exec("DROP TABLE chat_messages_pre_composite_pk");
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_pax ON chat_messages (tenant_id, passenger_id, created_at)",
      );
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at)",
      );
    },
  },
  {
    // metrics_events had no tenant column at all — every deployment's events
    // were mixed together with no way to scope a query (or an eventual
    // erasure request) to one tenant. Nullable: existing rows and any client
    // too old to send a tenant stay valid, just unscoped.
    id: "2026_08_metrics_events_tenant_id",
    up: async (db) => {
      if (!(await tableExists(db, "metrics_events"))) return;
      await db.exec("ALTER TABLE metrics_events ADD COLUMN tenant_id TEXT");
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_metrics_tenant_created ON metrics_events (tenant_id, created_at)",
      );
    },
  },
];
