import { describe, it, expect } from "vitest";

import { resolveOutbound } from "./fidsService";

// No FLIGHTAWARE_API_KEY in the test env → resolveOutbound returns the static
// registry-backed fallback, which is what these assertions lock (Phase 2).
describe("resolveOutbound (static / registry-backed)", () => {
  it("resolves a known PEK flight's gate and destination from the registry", async () => {
    const r = await resolveOutbound("CA783");
    expect(r.source).toBe("static");
    expect(r.gateId).toBe("E15");
    expect(r.outboundTo).toBe("Frankfurt");
  });

  it("normalizes spaced flight ids", async () => {
    const r = await resolveOutbound("CA 783");
    expect(r.gateId).toBe("E15");
  });

  it("falls back to the hub default transfer gate for unknown flights", async () => {
    const r = await resolveOutbound("ZZ9999");
    expect(r.gateId).toBe("E19");
  });

  it("lets a caller-provided gate win over the static gate", async () => {
    const r = await resolveOutbound("CA783", "E40");
    expect(r.gateId).toBe("E40");
  });

  it("resolves via the default airport when an unknown airportId is given", async () => {
    const r = await resolveOutbound("CA783", undefined, undefined, "LHR");
    expect(r.gateId).toBe("E15");
  });
});
