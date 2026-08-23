import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { PaxInviteStore, type CreateInviteInput } from "./PaxInviteStore";

const dirs: string[] = [];
const dbs: SqlDb[] = [];

async function newStore(): Promise<PaxInviteStore> {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-invites-"));
  dirs.push(dir);
  const db = createSqliteDb(path.join(dir, "test.db"));
  dbs.push(db);
  const store = new PaxInviteStore(db);
  await store.init();
  return store;
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

const baseInput: CreateInviteInput = {
  tenantId: "airchina",
  passengerId: "PAX-UUID-1",
  passengerName: "Siyao Fu",
  flightId: "UA888",
  flightDate: "2026-08-17",
  leg: "inbound",
  expiresAt: Date.now() + 60_000,
  createdBy: "ops@example.com",
};

describe("PaxInviteStore", () => {
  it("issues an invite whose secret is not recoverable from the record", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);

    expect(invite.inviteId).toMatch(/^inv_/);
    expect(token.length).toBeGreaterThan(20);
    expect(invite.deviceBound).toBe(false);
    expect(invite.redeemCount).toBe(0);
    expect(JSON.stringify(invite)).not.toContain(token);
  });

  it("binds the first device and lets it back in", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);

    const first = await store.redeem(invite.inviteId, token, "device-a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.boundNow).toBe(true);
    expect(first.invite.deviceBound).toBe(true);

    const second = await store.redeem(invite.inviteId, token, "device-a");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.boundNow).toBe(false);
    expect(second.invite.redeemCount).toBe(2);
  });

  it("refuses a second device even with the correct secret", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);
    await store.redeem(invite.inviteId, token, "device-a");

    const other = await store.redeem(invite.inviteId, token, "device-b");
    expect(other).toEqual({ ok: false, reason: "device_mismatch" });
  });

  it("rejects a wrong secret before looking at the device", async () => {
    const store = await newStore();
    const { invite } = await store.create(baseInput);

    const result = await store.redeem(invite.inviteId, "not-the-token", "device-a");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });

    // A failed attempt must not have claimed the binding.
    const stored = await store.get(invite.inviteId);
    expect(stored?.deviceBound).toBe(false);
  });

  it("reports a missing invite", async () => {
    const store = await newStore();
    const result = await store.redeem("inv_nope", "whatever", "device-a");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an expired invite", async () => {
    const store = await newStore();
    const { invite, token } = await store.create({ ...baseInput, expiresAt: Date.now() - 1 });

    const result = await store.redeem(invite.inviteId, token, "device-a");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a revoked invite", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);

    expect(await store.revoke(invite.inviteId)).toBe(true);
    // Revoking twice is a no-op, not an error.
    expect(await store.revoke(invite.inviteId)).toBe(false);

    const result = await store.redeem(invite.inviteId, token, "device-a");
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("lets a support reset hand the invite to a new device", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);
    await store.redeem(invite.inviteId, token, "old-phone");
    expect(await store.redeem(invite.inviteId, token, "new-phone")).toEqual({
      ok: false,
      reason: "device_mismatch",
    });

    await store.resetDevice(invite.inviteId);

    const afterReset = await store.redeem(invite.inviteId, token, "new-phone");
    expect(afterReset.ok).toBe(true);
    if (!afterReset.ok) return;
    expect(afterReset.boundNow).toBe(true);
  });

  it("binds exactly one device when two race for a fresh invite", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);

    const [a, b] = await Promise.all([
      store.redeem(invite.inviteId, token, "device-a"),
      store.redeem(invite.inviteId, token, "device-b"),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.reason).toBe("device_mismatch");
  });

  it("refreshes the flight snapshot without touching the binding", async () => {
    const store = await newStore();
    const { invite, token } = await store.create(baseInput);
    await store.redeem(invite.inviteId, token, "device-a");

    await store.updateFlightSnapshot(invite.inviteId, {
      depIata: "SFO",
      arrIata: "PEK",
      depTerminal: "I",
      depGate: "G1",
      arrTerminal: "3",
      arrGate: "E30",
      scheduledDepUtc: "2026-08-16T17:45:00Z",
      scheduledArrUtc: "2026-08-17T07:25:00Z",
      status: "En Route / On Time",
    });

    const updated = await store.get(invite.inviteId);
    expect(updated?.flight.arrGate).toBe("E30");
    expect(updated?.flight.depIata).toBe("SFO");
    expect(updated?.deviceBound).toBe(true);
  });

  it("scopes the list to one tenant", async () => {
    const store = await newStore();
    await store.create({ ...baseInput, passengerId: "PAX-1" });
    await store.create({ ...baseInput, passengerId: "PAX-2" });
    await store.create({ ...baseInput, tenantId: "other", passengerId: "PAX-3" });

    const list = await store.list("airchina");
    expect(list.map((i) => i.passengerId).sort()).toEqual(["PAX-1", "PAX-2"]);
  });

  it("hard-deletes a row and counts remaining invites per passenger", async () => {
    const store = await newStore();
    const a = await store.create({ ...baseInput, passengerId: "PAX-KEEP" });
    const b = await store.create({ ...baseInput, passengerId: "PAX-KEEP" });
    expect(await store.countForPassenger("airchina", "PAX-KEEP")).toBe(2);

    expect(await store.remove(a.invite.inviteId)).toBe(true);
    expect(await store.get(a.invite.inviteId)).toBeNull();
    expect(await store.countForPassenger("airchina", "PAX-KEEP")).toBe(1);
    expect(await store.get(b.invite.inviteId)).not.toBeNull();
    expect(await store.remove("inv_missing")).toBe(false);
  });

  it("removes every invite for one passenger, leaving other passengers alone", async () => {
    const store = await newStore();
    // Erasing a passenger has to take their invites: redeeming one re-creates
    // the registry record, so a surviving link would undo the deletion.
    const a = await store.create({ ...baseInput, passengerId: "PAX-GONE" });
    const b = await store.create({ ...baseInput, passengerId: "PAX-GONE" });
    const other = await store.create({ ...baseInput, passengerId: "PAX-STAYS" });
    const otherTenant = await store.create({
      ...baseInput,
      tenantId: "other",
      passengerId: "PAX-GONE",
    });

    expect(await store.removeAllForPassenger("airchina", "PAX-GONE")).toBe(2);
    expect(await store.get(a.invite.inviteId)).toBeNull();
    expect(await store.get(b.invite.inviteId)).toBeNull();
    expect(await store.get(other.invite.inviteId)).not.toBeNull();
    // Same passenger id under a different tenant is a different person.
    expect(await store.get(otherTenant.invite.inviteId)).not.toBeNull();
  });

  it("reports zero when a passenger has no invites", async () => {
    const store = await newStore();
    expect(await store.removeAllForPassenger("airchina", "PAX-NONE")).toBe(0);
  });

  it("lists only revoked or expired invites", async () => {
    const store = await newStore();
    const live = await store.create(baseInput);
    const expired = await store.create({
      ...baseInput,
      passengerId: "PAX-OLD",
      expiresAt: Date.now() - 1,
    });
    const revoked = await store.create({ ...baseInput, passengerId: "PAX-REV" });
    await store.revoke(revoked.invite.inviteId);

    const inactive = await store.listInactive("airchina");
    expect(inactive.map((i) => i.inviteId).sort()).toEqual(
      [expired.invite.inviteId, revoked.invite.inviteId].sort(),
    );
    expect(inactive.some((i) => i.inviteId === live.invite.inviteId)).toBe(false);
  });
});
