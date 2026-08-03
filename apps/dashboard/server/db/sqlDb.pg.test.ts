/**
 * Postgres-specific regression coverage for sqlDb.ts.
 *
 * Every other *.test.ts in this repo exercises the SQLite path only — the
 * `?` → `$n` placeholder rewrite, `ON CONFLICT` upsert semantics, and
 * PgDb.transaction's dedicated-client handling are otherwise never run
 * against a real Postgres before a --profile scale (DATABASE_URL) deploy.
 *
 * Skipped entirely (not failed) unless TEST_DATABASE_URL is set — CI's
 * "postgres" job (.github/workflows/ci.yml) provides a throwaway Postgres
 * service container and sets it; local `npm test` without Postgres running
 * skips this file with a clear reason instead of erroring.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPgDb, type SqlDb } from "./sqlDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TABLE = "sqldb_pg_test_widgets";

describe.skipIf(!TEST_DATABASE_URL)("PgDb (real Postgres)", () => {
  let db: SqlDb;

  async function freshDb(): Promise<SqlDb> {
    db = createPgDb(TEST_DATABASE_URL!);
    await db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
    await db.exec(`
      CREATE TABLE ${TABLE} (
        id    TEXT NOT NULL,
        scope TEXT NOT NULL,
        name  TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scope, id)
      );
    `);
    return db;
  }

  afterEach(async () => {
    try { await db?.exec(`DROP TABLE IF EXISTS ${TABLE}`); } catch { /* ignore */ }
    try { await db?.close(); } catch { /* ignore */ }
  });

  afterAll(async () => {
    // Extra safety net in case a test above failed before its own cleanup ran.
    const cleanup = createPgDb(TEST_DATABASE_URL!);
    try { await cleanup.exec(`DROP TABLE IF EXISTS ${TABLE}`); } catch { /* ignore */ }
    await cleanup.close();
  });

  it("connects and reports the pg dialect", async () => {
    const db = await freshDb();
    expect(db.dialect).toBe("pg");
    expect(await db.ping()).toBe(true);
  });

  it("rewrites ? placeholders to $n correctly, including repeated and many params", async () => {
    const db = await freshDb();
    await db.run(`INSERT INTO ${TABLE} (id, scope, name, count) VALUES (?, ?, ?, ?)`, ["a", "s1", "Alice", 1]);
    const row = await db.get<{ name: string; count: number }>(
      `SELECT name, count FROM ${TABLE} WHERE id = ? AND scope = ?`,
      ["a", "s1"],
    );
    expect(row).toEqual({ name: "Alice", count: 1 });

    const rows = await db.all<{ id: string }>(
      `SELECT id FROM ${TABLE} WHERE scope = ? AND (id = ? OR id = ? OR count > ?) ORDER BY id`,
      ["s1", "a", "b", 0],
    );
    expect(rows).toEqual([{ id: "a" }]);
  });

  it("ON CONFLICT DO UPDATE overwrites on the declared conflict target", async () => {
    const db = await freshDb();
    const upsert = (name: string, count: number) =>
      db.run(
        `INSERT INTO ${TABLE} (id, scope, name, count) VALUES (?, ?, ?, ?)
         ON CONFLICT (scope, id) DO UPDATE SET name = excluded.name, count = excluded.count`,
        ["a", "s1", name, count],
      );
    await upsert("Alice", 1);
    await upsert("Alice V2", 2);
    const row = await db.get<{ name: string; count: number }>(
      `SELECT name, count FROM ${TABLE} WHERE id = ? AND scope = ?`,
      ["a", "s1"],
    );
    expect(row).toEqual({ name: "Alice V2", count: 2 });
  });

  it("ON CONFLICT DO NOTHING keeps the first row on a concurrent-style insert race", async () => {
    const db = await freshDb();
    const insertIgnoring = (name: string) =>
      db.run(
        `INSERT INTO ${TABLE} (id, scope, name) VALUES (?, ?, ?) ON CONFLICT (scope, id) DO NOTHING`,
        ["a", "s1", name],
      );
    await Promise.all([insertIgnoring("First"), insertIgnoring("Second"), insertIgnoring("Third")]);
    const rows = await db.all<{ name: string }>(`SELECT name FROM ${TABLE} WHERE id = ? AND scope = ?`, ["a", "s1"]);
    expect(rows).toHaveLength(1); // exactly one survivor, never a duplicate-key error
  });

  it("commits a transaction's writes together", async () => {
    const db = await freshDb();
    await db.transaction(async (tx) => {
      await tx.run(`INSERT INTO ${TABLE} (id, scope, name) VALUES (?, ?, ?)`, ["a", "s1", "A"]);
      await tx.run(`INSERT INTO ${TABLE} (id, scope, name) VALUES (?, ?, ?)`, ["b", "s1", "B"]);
    });
    const rows = await db.all<{ id: string }>(`SELECT id FROM ${TABLE} WHERE scope = ? ORDER BY id`, ["s1"]);
    expect(rows).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("rolls back every statement in a failed transaction, using its own dedicated connection", async () => {
    const db = await freshDb();
    await db.run(`INSERT INTO ${TABLE} (id, scope, name) VALUES (?, ?, ?)`, ["pre-existing", "s1", "Pre"]);

    await expect(
      db.transaction(async (tx) => {
        await tx.run(`INSERT INTO ${TABLE} (id, scope, name) VALUES (?, ?, ?)`, ["a", "s1", "A"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await db.all<{ id: string }>(`SELECT id FROM ${TABLE} WHERE scope = ? ORDER BY id`, ["s1"]);
    // Only the pre-existing row survives; the transaction's insert rolled back.
    expect(rows).toEqual([{ id: "pre-existing" }]);
  });

  it("BIGINT columns come back as JS numbers, not strings", async () => {
    const db = await freshDb();
    await db.exec(`ALTER TABLE ${TABLE} ADD COLUMN created_at BIGINT`);
    const big = Date.now();
    await db.run(`INSERT INTO ${TABLE} (id, scope, name, created_at) VALUES (?, ?, ?, ?)`, ["a", "s1", "A", big]);
    const row = await db.get<{ created_at: number }>(`SELECT created_at FROM ${TABLE} WHERE id = ?`, ["a"]);
    expect(typeof row?.created_at).toBe("number");
    expect(row?.created_at).toBe(big);
  });
});
