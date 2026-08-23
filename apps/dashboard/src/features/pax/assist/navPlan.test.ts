import { describe, expect, it } from "vitest";
import { gateHintsForLeg } from "./navPlan";

describe("gateHintsForLeg", () => {
  // The flight page passes the departure gate as both ends of the map view, and
  // the planner used to prefill 起点 with it — the passenger was told they were
  // starting at the gate they had not reached yet.
  it("treats a departure gate as the destination", () => {
    expect(gateHintsForLeg("G1", "G1", "dep")).toEqual({ toGateHint: "G1" });
  });

  it("treats an arrival gate as the starting point", () => {
    expect(gateHintsForLeg("E21", "E21", "arr")).toEqual({ fromGateHint: "E21" });
  });

  it("keeps both ends of a real transfer route", () => {
    expect(gateHintsForLeg("E21", "G8", "dep")).toEqual({
      fromGateHint: "E21",
      toGateHint: "G8",
    });
  });

  it("uses whichever single gate is known", () => {
    expect(gateHintsForLeg(undefined, "G8", "dep")).toEqual({ toGateHint: "G8" });
    expect(gateHintsForLeg("G8", undefined, "dep")).toEqual({ toGateHint: "G8" });
    expect(gateHintsForLeg("E21", undefined, "arr")).toEqual({ fromGateHint: "E21" });
  });

  it("returns nothing to prefill when no gate is assigned yet", () => {
    expect(gateHintsForLeg(undefined, undefined, "dep")).toEqual({});
  });
});
