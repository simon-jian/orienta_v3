/**
 * Lightweight, dialect-agnostic schema migration runner.
 *
 * Each store still owns its own idempotent `CREATE TABLE IF NOT EXISTS` in its
 * `init()` — safe to re-run forever, so it stays as-is and keeps creating a
 * fresh database's baseline schema. This runner is for everything a bare
 * `CREATE TABLE IF NOT EXISTS` can't express on an EXISTING database: adding a
 * column, changing a primary key, backfilling data. Each migration runs at
 * most once (tracked by id in `schema_migrations`) inside its own transaction,
 * in the order the array is given — array order IS migration order, there is
 * no timestamp/dependency resolution.
 *
 * Call `runMigrations()` once at boot, after every store's `init()` has run
 * (so a fresh database already has its baseline tables before a migration
 * that assumes a table exists gets a chance to run against it).
 */
import type { SqlDb } from "./sqlDb";
import { logger } from "../lib/logger";

export interface Migration {
  /** Stable, never-reused identifier. Convention: "YYYY_MM_short_description". */
  id: string;
  up: (db: SqlDb) => Promise<void>;
}

export async function runMigrations(db: SqlDb, migrations: Migration[]): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT NOT NULL,
      applied_at  BIGINT NOT NULL,
      PRIMARY KEY (id)
    );
  `);

  for (const migration of migrations) {
    const already = await db.get<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = ?",
      [migration.id],
    );
    if (already) continue;

    logger.info("migration_running", { id: migration.id });
    await db.transaction(async (tx) => {
      await migration.up(tx);
      await tx.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [migration.id, Date.now()]);
    });
    logger.info("migration_applied", { id: migration.id });
  }
}
