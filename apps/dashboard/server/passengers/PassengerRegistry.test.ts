import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { PassengerRegistry, type CreatePassengerInput } from "./PassengerRegistry";

const dirs: string[] = [];
const dbs: SqlDb[] = [];
function trackDb(dbPath: string): SqlDb {
  const db = createSqliteDb(dbPath);
  dbs.push(db);
  return db;
}
async function newRegistry(): Promise<PassengerRegistry> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-registry-"));
  dirs.push(dir);
  const registry = new PassengerRegistry(trackDb(path.join(dir, "test.db")));
  await registry.init();
  return registry;
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

const baseInput: CreatePassengerInput = {
  id: "TX1", tenantId: "airchina", flightId: "CA123", gateId: "E19", name: "Alice",
};

describe("PassengerRegistry.getOrCreate", () => {
  it("creates a new passenger when none exists", async () => {
    const registry = await newRegistry();
    const record = await registry.getOrCreate(baseInput);
    expect(record.id).toBe("TX1");
    expect(record.name).toBe("Alice");
  });

  it("returns the existing row unchanged on a second call, not a fresh one", async () => {
    const registry = await newRegistry();
    const first = await registry.getOrCreate(baseInput);
    const second = await registry.getOrCreate({ ...baseInput, name: "Someone Else" });
    expect(second.id).toBe(first.id);
    // The upsert is ON CONFLICT DO NOTHING — the second call's differing
    // `name` must NOT overwrite the row created by the first call.
    expect(second.name).toBe("Alice");
  });

  it(
    "handles two concurrent getOrCreate calls for the same id without throwing " +
      "(regression test: previously a check-then-insert race threw a primary-key violation)",
    async () => {
      const registry = await newRegistry();
      const [a, b] = await Promise.all([
        registry.getOrCreate(baseInput),
        registry.getOrCreate(baseInput),
      ]);
      expect(a.id).toBe(b.id);
      const all = await registry.list("airchina");
      expect(all).toHaveLength(1);
    },
  );

  it("caps oversized field lengths at the registry boundary", async () => {
    const registry = await newRegistry();
    const longName = "A".repeat(500);
    const record = await registry.getOrCreate({ ...baseInput, name: longName });
    expect(record.name.length).toBeLessThan(500);
    expect(record.name.length).toBe(200);
  });
});

describe("PassengerRegistry.applyTrip", () => {
  it("moves a returning passenger onto their new itinerary", async () => {
    const registry = await newRegistry();
    await registry.getOrCreate({ ...baseInput, flightId: "UA889", gateId: "E16", outboundTo: "SFO" });

    const updated = await registry.applyTrip("airchina", "TX1", {
      flightId: "UA888",
      gateId: "G3",
      outboundTo: "PEK",
    });

    expect(updated?.flightId).toBe("UA888");
    expect(updated?.gateId).toBe("G3");
    expect(updated?.transfer.outboundTo).toBe("PEK");
  });

  it("keeps known values when the new lookup has none (airlines publish gates late)", async () => {
    const registry = await newRegistry();
    await registry.getOrCreate({ ...baseInput, flightId: "UA889", gateId: "E16" });

    const updated = await registry.applyTrip("airchina", "TX1", { flightId: "UA888", gateId: "" });

    expect(updated?.flightId).toBe("UA888");
    expect(updated?.gateId).toBe("E16");
  });

  it("is a no-op for an unknown passenger", async () => {
    const registry = await newRegistry();
    expect(await registry.applyTrip("airchina", "NOPE", { flightId: "UA888" })).toBeNull();
  });
});
