import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDb, type SqlDb } from "../db/sqlDb";
import { JourneyStore } from "./JourneyStore";

describe("JourneyStore", () => {
  let db: SqlDb;
  let store: JourneyStore;

  beforeEach(async () => {
    db = createSqliteDb(":memory:");
    store = new JourneyStore(db);
    await store.init();
  });

  afterEach(async () => {
    await db.close();
  });

  it("upserts preferences and lists empty events", async () => {
    const key = { flightIdentifier: "CA123", flightDate: "2026-08-09" };
    const prefs = await store.upsertPreferences(key, {
      checkedBags: true,
      arrivalDestination: "rideshare",
    });
    expect(prefs.checkedBags).toBe(true);
    expect(prefs.arrivalDestination).toBe("rideshare");
    expect(await store.listEvents(key)).toEqual([]);
  });

  it("enforces monotonic journey events", async () => {
    const key = { flightIdentifier: "CA999", flightDate: "2026-08-09" };
    await store.addEvent(key, {
      eventType: "off_plane",
      source: "test",
      eventTime: "2026-08-09T10:00:00.000Z",
    });
    await expect(
      store.addEvent(key, {
        eventType: "off_plane",
        source: "test",
        eventTime: "2026-08-09T10:05:00.000Z",
      }),
    ).rejects.toThrow(/monotonic/i);
  });

  it("creates and validates arrival shares", async () => {
    const key = { flightIdentifier: "UA100", flightDate: "2026-08-09" };
    const created = await store.createOrReuseShare(key);
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    const pub = await store.getPublicShare(created.shareId, created.publicToken);
    expect(pub?.flightIdentifier).toBe("UA100");
    expect(await store.revokeShare(created.shareId, created.managementToken)).toBe(true);
    expect(await store.getPublicShare(created.shareId, created.publicToken)).toBeNull();
  });
});
