import { describe, it, expect, beforeAll } from "vitest";

import { resolveOutbound } from "./fidsService";
import { registerAirport } from "../../src/config/airports/registry";
import type { AirportDefinition } from "../../src/config/airports/types";

const TEST_AIRPORT: AirportDefinition = {
  id: "PEK",
  iata: "PEK",
  name: "Test Airport",
  terminals: [{ id: "T3E", label: "T3E" }],
  defaultTerminal: "T3E",
  defaultGate: "E19",
  poi: { mode: "none", parser: "generic", defaultCenter: { lat: 0, lng: 0 } },
  map: { indoorMapEnabled: false },
};

beforeAll(() => {
  registerAirport(TEST_AIRPORT);
});

// No FLIGHTAWARE_API_KEY in the test env → resolveOutbound returns the
// caller-hint / default-gate fallback (no demo schedule is bundled).
describe("resolveOutbound (fallback, no live key)", () => {
  it("uses the airport's configured defaultGate when no caller hint is given", async () => {
    const r = await resolveOutbound("CA783");
    expect(r.source).toBe("fallback");
    expect(r.gateId).toBe("E19");
    expect(r.outboundTo).toBe("");
  });

  it("lets a caller-provided gate win over the default", async () => {
    const r = await resolveOutbound("CA783", "E40");
    expect(r.gateId).toBe("E40");
  });

  it("lets a caller-provided destination through", async () => {
    const r = await resolveOutbound("CA783", undefined, "Frankfurt");
    expect(r.outboundTo).toBe("Frankfurt");
  });

  it("estimates a future departure time", async () => {
    const r = await resolveOutbound("ZZ9999");
    expect(r.scheduledDepMs).toBeGreaterThan(Date.now());
  });

  it("falls back to a generic placeholder when the airport itself has no defaultGate configured", async () => {
    registerAirport({ ...TEST_AIRPORT, id: "XXX", iata: "XXX", defaultGate: undefined });
    const r = await resolveOutbound("ZZ1234", undefined, undefined, "XXX");
    expect(r.gateId).toBe("UNKNOWN");
  });
});
