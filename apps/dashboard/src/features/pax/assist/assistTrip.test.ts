import { describe, expect, it } from "vitest";
import { baseInfoStrip, flightLabel } from "./assistTrip";
import type { PaxSession } from "../session";

const session: PaxSession = {
  token: "t",
  passenger: {
    id: "P1",
    tenantId: "airchina",
    name: "Guest",
    plan: "free",
    flightId: "UA889",
    gateId: "E19",
  },
  accountType: "temporary",
  plan: "free",
  capabilities: ["navigate", "receive_notifications", "share_location"],
  expiresAt: Date.now() + 60_000,
};

describe("assistTrip info strip", () => {
  it("formats depart outbound from session flight", () => {
    const strip = baseInfoStrip(session, { intent: "depart", flight: "UA889" }, { status: "Assisted" });
    expect(strip.outbound).toBe("UA889");
    expect(strip.inbound).toBe("—");
    expect(strip.gate).toBe("E19");
    expect(strip.status).toBe("Assisted");
  });

  it("formats transfer inbound/outbound", () => {
    const strip = baseInfoStrip(session, {
      intent: "transfer",
      arrivalFlight: "CA835",
      departureFlight: "CA783",
    });
    expect(strip.inbound).toBe("CA835");
    expect(strip.outbound).toBe("CA783");
  });

  it("builds FA-enriched labels", () => {
    expect(flightLabel("UA889", "PEK", "E23")).toBe("UA889 – PEK – E23");
  });
});
