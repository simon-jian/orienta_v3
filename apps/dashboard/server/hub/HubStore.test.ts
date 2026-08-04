import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { HubStore } from "./HubStore";

// Regression coverage for HubStore.pruneIdleCaches(): chatHistories/paxMeta/
// paxTrajectories previously had no cleanup path at all except an explicit
// passenger delete — a passenger who simply went offline (without being
// deleted) stayed cached in memory for the life of the process.
describe("HubStore.pruneIdleCaches", () => {
  it("evicts a disconnected passenger's stale chat/meta/trajectory entries", () => {
    const store = new HubStore();
    store.appendChat("airchina", "P1", {
      id: "m1", passengerId: "P1", tenantId: "airchina", from: "pax", kind: "text", body: "hi", createdAt: Date.now(),
    });
    store.setPaxMeta("airchina", "P1", { displayName: "Alice" });
    store.setTrajectory("airchina", "P1", { path: [{ lat: 1, lng: 1 }], position: { lat: 1, lng: 1 } });

    const evicted = store.pruneIdleCaches(-1); // treat everything as stale
    expect(evicted).toBe(1);
    expect(store.getChatHistory("airchina", "P1")).toEqual([]);
    expect(store.paxMeta.get(HubStore.key("airchina", "P1"))).toBeUndefined();
    expect(store.getTrajectory("airchina", "P1")).toBeUndefined();
  });

  it("never evicts a passenger with a currently-open WebSocket, regardless of staleness", () => {
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { displayName: "Alice" });
    const key = HubStore.key("airchina", "P1");
    store.paxSockets.set(key, new Set([{ readyState: WebSocket.OPEN } as unknown as WebSocket]));

    const evicted = store.pruneIdleCaches(-1);
    expect(evicted).toBe(0);
    expect(store.paxMeta.get(key)).toEqual({ displayName: "Alice" });
  });

  it("leaves a recently-touched (not yet idle) entry alone", () => {
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { displayName: "Alice" });

    const evicted = store.pruneIdleCaches(60 * 60_000); // 1h window; entry is milliseconds old
    expect(evicted).toBe(0);
    expect(store.paxMeta.get(HubStore.key("airchina", "P1"))).toEqual({ displayName: "Alice" });
  });

  it("does not touch a different passenger's entries", () => {
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { displayName: "Alice" });
    store.setPaxMeta("airchina", "P2", { displayName: "Bob" });
    const keyP1 = HubStore.key("airchina", "P1");
    store.paxSockets.set(keyP1, new Set([{ readyState: WebSocket.OPEN } as unknown as WebSocket]));

    const evicted = store.pruneIdleCaches(-1);
    expect(evicted).toBe(1); // only P2, since P1 is "connected"
    expect(store.paxMeta.get(keyP1)).toEqual({ displayName: "Alice" });
    expect(store.paxMeta.get(HubStore.key("airchina", "P2"))).toBeUndefined();
  });
});

// Not a comprehensive HubStore suite — just enough to pin down setPaxMeta's
// contract now that wsHub.ts goes through it instead of a raw Map.set().
describe("HubStore.setPaxMeta", () => {
  it("stores and overwrites a passenger's meta", () => {
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { displayName: "Alice", plan: "free" });
    expect(store.paxMeta.get(HubStore.key("airchina", "P1"))).toEqual({ displayName: "Alice", plan: "free" });
    store.setPaxMeta("airchina", "P1", { displayName: "Alice V2", plan: "premium" });
    expect(store.paxMeta.get(HubStore.key("airchina", "P1"))).toEqual({ displayName: "Alice V2", plan: "premium" });
  });
});
