import { describe, it, expect } from "vitest";

import { resolveOutbound } from "./fidsService";

// No FLIGHTAWARE_API_KEY in the test env → resolveOutbound returns the
// caller-hint / default-gate fallback (no demo schedule is bundled).
describe("resolveOutbound (fallback, no live key)", () => {
  it("uses the generic default gate when no caller hint is given", async () => {
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
});
