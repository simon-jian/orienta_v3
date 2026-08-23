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

/**
 * Add a column only when it is absent.
 *
 * `tableExists` alone is not enough: on a fresh database the store's `init()`
 * has already created the table at the current baseline shape, which includes
 * every column these migrations were written to add. A bare `ADD COLUMN` then
 * aborts the whole boot with "duplicate column name" — the table exists, so
 * the migration ran, and the column was already there.
 */
async function addColumnIfMissing(
  db: SqlDb,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  if (db.dialect === "pg") {
    // Postgres can express this directly, and its DDL is transactional, so a
    // concurrent boot racing on the same column cannot half-apply it.
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    return;
  }
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
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
      await addColumnIfMissing(db, "metrics_events", "tenant_id", "TEXT");
      await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_metrics_tenant_created ON metrics_events (tenant_id, created_at)",
      );
    },
  },
  {
    // pax_invites recorded that *a* device had claimed a link but nothing about
    // it, so the support desk could not tell whether a passenger reporting
    // "it won't open" was on the phone that claimed it, nor whether their OS can
    // receive Web Push at all. All nullable: rows bound before this stay valid
    // and simply have no device description until their next redemption.
    id: "2026_08_pax_invites_device_summary",
    up: async (db) => {
      if (!(await tableExists(db, "pax_invites"))) return;
      await addColumnIfMissing(db, "pax_invites", "device_os", "TEXT");
      await addColumnIfMissing(db, "pax_invites", "device_os_version", "TEXT");
      await addColumnIfMissing(db, "pax_invites", "device_browser", "TEXT");
      await addColumnIfMissing(db, "pax_invites", "device_is_mobile", "INTEGER");
    },
  },
];
