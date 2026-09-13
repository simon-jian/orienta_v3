import { describe, expect, it } from "vitest";
import { parseCallMessage, relayCallMessage, resolveCallPassengerId } from "./callRelay";

function storeSpy() {
  const admins: unknown[] = [];
  const pax: Array<{ passengerId: string; msg: unknown }> = [];
  return {
    admins,
    pax,
    store: {
      broadcastAdmins: (_tenantId: string, msg: unknown) => { admins.push(msg); },
      broadcastPax: (_tenantId: string, passengerId: string, msg: unknown) => {
        pax.push({ passengerId, msg });
      },
    },
  };
}

describe("parseCallMessage", () => {
  it("accepts a valid invite", () => {
    expect(parseCallMessage({
      type: "call_invite",
      callId: "c1",
      mode: "audio",
      from: "admin",
      passengerId: "P1",
    })).toMatchObject({ type: "call_invite", callId: "c1", mode: "audio", from: "admin", passengerId: "P1" });
  });

  it("drops malformed payloads", () => {
    expect(parseCallMessage({ type: "call_invite", callId: "c1" })).toBeNull();
    expect(parseCallMessage({ type: "call_invite", callId: "c1", mode: "fax", from: "admin" })).toBeNull();
    expect(parseCallMessage({ type: "call_signal", callId: "c1" })).toBeNull();
    expect(parseCallMessage({ type: "call_hangup" })).toBeNull();
    expect(parseCallMessage({ type: "chat_send", callId: "c1" })).toBeNull();
  });

  it("accepts hangup/accept/reject with callId only", () => {
    expect(parseCallMessage({ type: "call_hangup", callId: "c1" })?.type).toBe("call_hangup");
    expect(parseCallMessage({ type: "call_accept", callId: "c1" })?.type).toBe("call_accept");
    expect(parseCallMessage({ type: "call_reject", callId: "c1" })?.type).toBe("call_reject");
  });

  it("keeps from on call_signal so peers can ignore their own echo", () => {
    expect(parseCallMessage({
      type: "call_signal",
      callId: "c1",
      from: "pax",
      sdp: { type: "offer", sdp: "v=0" },
    })).toMatchObject({ from: "pax", sdp: { type: "offer" } });
  });
});

describe("resolveCallPassengerId", () => {
  it("forces the pax session id and rejects a spoofed id", () => {
    expect(resolveCallPassengerId("pax", "P1", undefined)).toBe("P1");
    expect(resolveCallPassengerId("pax", "P1", "P1")).toBe("P1");
    expect(resolveCallPassengerId("pax", "P1", "P2")).toBeNull();
    expect(resolveCallPassengerId("admin", null, "P9")).toBe("P9");
    expect(resolveCallPassengerId("admin", null, "")).toBeNull();
  });
});

describe("relayCallMessage", () => {
  it("relays an admin invite only for that passenger", () => {
    const spy = storeSpy();
    const ok = relayCallMessage(spy.store, {
      role: "admin",
      tenantId: "airchina",
      msg: { type: "call_invite", callId: "c1", mode: "video", from: "admin", passengerId: "P1" },
    });
    expect(ok).toBe(true);
    expect(spy.pax).toHaveLength(1);
    expect(spy.pax[0]?.passengerId).toBe("P1");
    expect(spy.admins).toHaveLength(1);
  });

  it("relays a pax invite to admins of that passenger only", () => {
    const spy = storeSpy();
    const ok = relayCallMessage(spy.store, {
      role: "pax",
      tenantId: "airchina",
      sessionPassengerId: "P2",
      msg: { type: "call_invite", callId: "c2", mode: "audio", from: "pax" },
    });
    expect(ok).toBe(true);
    expect(spy.pax[0]?.passengerId).toBe("P2");
    expect(spy.admins).toHaveLength(1);
    expect((spy.admins[0] as { from?: string }).from).toBe("pax");
  });

  it("does not relay a pax frame that names another passenger", () => {
    const spy = storeSpy();
    const ok = relayCallMessage(spy.store, {
      role: "pax",
      tenantId: "airchina",
      sessionPassengerId: "P2",
      msg: { type: "call_invite", callId: "c2", mode: "audio", from: "pax", passengerId: "P9" },
    });
    expect(ok).toBe(false);
    expect(spy.admins).toEqual([]);
    expect(spy.pax).toEqual([]);
  });
});
