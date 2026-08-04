import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { AuditLog } from "./auditLog";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
async function newAuditLog(): Promise<AuditLog> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-auditlog-"));
  dirs.push(dir);
  const db = createSqliteDb(path.join(dir, "test.db"));
  dbs.push(db);
  const log = new AuditLog(db);
  await log.init();
  return log;
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

describe("AuditLog.listForPassenger", () => {
  it("returns only entries for the given tenant+passenger, most recent first", async () => {
    const log = await newAuditLog();
    await log.record({ actorEmail: "admin@test.com", action: "passenger_create", tenantId: "airchina", passengerId: "P1" });
    await log.record({ actorEmail: "admin@test.com", action: "passenger_update", tenantId: "airchina", passengerId: "P1", detail: "plan" });
    await log.record({ actorEmail: "admin@test.com", action: "passenger_create", tenantId: "airchina", passengerId: "P2" }); // different passenger
    await log.record({ actorEmail: "admin@test.com", action: "passenger_create", tenantId: "united", passengerId: "P1" }); // different tenant

    const entries = await log.listForPassenger("airchina", "P1");
    expect(entries.map((e) => e.action)).toEqual(["passenger_update", "passenger_create"]);
    expect(entries[0]?.detail).toBe("plan");
  });

  it("returns an empty array for a passenger with no recorded events", async () => {
    const log = await newAuditLog();
    expect(await log.listForPassenger("airchina", "nobody")).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const log = await newAuditLog();
    for (let i = 0; i < 5; i++) {
      await log.record({ actorEmail: "admin@test.com", action: `action_${i}`, tenantId: "airchina", passengerId: "P1" });
    }
    const entries = await log.listForPassenger("airchina", "P1", 2);
    expect(entries).toHaveLength(2);
  });
});
