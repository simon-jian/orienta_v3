import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "./sqlDb";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
async function newDb(): Promise<SqlDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-sqldb-"));
  dirs.push(dir);
  const db = createSqliteDb(path.join(dir, "test.db"));
  dbs.push(db);
  await db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
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

describe("SqlDb.transaction", () => {
  it("commits every statement issued through the tx handle", async () => {
    const db = await newDb();
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO widgets (name) VALUES (?)", ["a"]);
      await tx.run("INSERT INTO widgets (name) VALUES (?)", ["b"]);
    });
    expect(await db.all("SELECT name FROM widgets ORDER BY name")).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("rolls back every statement in the transaction if the callback throws", async () => {
    const db = await newDb();
    await db.run("INSERT INTO widgets (name) VALUES (?)", ["pre-existing"]);

    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO widgets (name) VALUES (?)", ["should-not-persist"]);
        throw new Error("simulated failure mid-transaction");
      }),
    ).rejects.toThrow("simulated failure mid-transaction");

    // Only the row inserted before the transaction started should remain —
    // the transaction's own insert must not have survived the rollback.
    expect(await db.all("SELECT name FROM widgets ORDER BY name")).toEqual([{ name: "pre-existing" }]);
  });

  it("propagates the callback's return value", async () => {
    const db = await newDb();
    const result = await db.transaction(async (tx) => {
      await tx.run("INSERT INTO widgets (name) VALUES (?)", ["a"]);
      return 42;
    });
    expect(result).toBe(42);
  });
});
