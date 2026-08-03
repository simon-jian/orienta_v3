import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "./sqlDb";
import { runMigrations, type Migration } from "./migrations";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
async function newDb(): Promise<SqlDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-migrations-"));
  dirs.push(dir);
  const db = createSqliteDb(path.join(dir, "test.db"));
  dbs.push(db);
  return db;
}

afterEach(async () => {
  while (dbs.length) {
    try { await dbs.pop()!.close(); } catch { /* ignore */ }
  }
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("runMigrations", () => {
  it("runs each migration exactly once, in order", async () => {
    const db = await newDb();
    const calls: string[] = [];
    const migrations: Migration[] = [
      { id: "m1", up: async () => { calls.push("m1"); } },
      { id: "m2", up: async () => { calls.push("m2"); } },
    ];
    await runMigrations(db, migrations);
    await runMigrations(db, migrations); // second boot: must not re-run
    expect(calls).toEqual(["m1", "m2"]);
  });

  it("only runs migrations not already recorded, even when new ones are appended later", async () => {
    const db = await newDb();
    const calls: string[] = [];
    await runMigrations(db, [{ id: "m1", up: async () => { calls.push("m1"); } }]);
    await runMigrations(db, [
      { id: "m1", up: async () => { calls.push("m1-again"); } },
      { id: "m2", up: async () => { calls.push("m2"); } },
    ]);
    expect(calls).toEqual(["m1", "m2"]);
  });

  it("rolls back a failed migration and does not record it as applied", async () => {
    const db = await newDb();
    await db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    await db.run("INSERT INTO widgets (name) VALUES (?)", ["a"]);

    const failing: Migration = {
      id: "m_bad",
      up: async (tx) => {
        await tx.run("INSERT INTO widgets (name) VALUES (?)", ["b"]);
        throw new Error("boom");
      },
    };
    await expect(runMigrations(db, [failing])).rejects.toThrow("boom");

    // The insert inside the failed migration must have rolled back.
    expect(await db.all("SELECT name FROM widgets ORDER BY name")).toEqual([{ name: "a" }]);
    // Not recorded as applied, so a retry after fixing the bug would run it again.
    expect(await db.get("SELECT id FROM schema_migrations WHERE id = ?", ["m_bad"])).toBeUndefined();
  });

  it(
    "the chat_messages composite-PK migration preserves existing rows and widens the conflict target",
    async () => {
      const db = await newDb();
      // Simulate the pre-migration schema (bare `id` primary key).
      await db.exec(`
        CREATE TABLE chat_messages (
          id TEXT NOT NULL, tenant_id TEXT NOT NULL, passenger_id TEXT NOT NULL,
          sender TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
          gate_ref TEXT, created_at BIGINT NOT NULL, PRIMARY KEY (id)
        );
      `);
      await db.run(
        "INSERT INTO chat_messages (id, tenant_id, passenger_id, sender, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["msg1", "airchina", "P1", "admin", "text", "hello", 1000],
      );

      const { migrations } = await import("./migrationList");
      await runMigrations(db, [migrations[0]!]);

      // Old row survived the recreate.
      expect(await db.all("SELECT id, tenant_id, body FROM chat_messages")).toEqual([
        { id: "msg1", tenant_id: "airchina", body: "hello" },
      ]);

      // Same id, different tenant, must now coexist instead of overwriting —
      // this is exactly the cross-tenant overwrite the migration closes.
      await db.run(
        `INSERT INTO chat_messages (id, tenant_id, passenger_id, sender, kind, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, id) DO UPDATE SET body = excluded.body`,
        ["msg1", "otherTenant", "P2", "admin", "text", "different tenant, same id", 2000],
      );
      const rows = await db.all<{ tenant_id: string; body: string }>(
        "SELECT tenant_id, body FROM chat_messages ORDER BY tenant_id",
      );
      expect(rows).toEqual([
        { tenant_id: "airchina", body: "hello" },
        { tenant_id: "otherTenant", body: "different tenant, same id" },
      ]);
    },
  );
});
