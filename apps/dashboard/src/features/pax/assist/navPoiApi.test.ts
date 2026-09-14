import { describe, expect, it } from "vitest";
import {
  applyNavPlanPrefill,
  matchPoiByGateHint,
  matchSecurityPoi,
  type NavPoi,
} from "./navPoiApi";

function gate(name: string, id = name): NavPoi {
  return { id, name, category: "gate", terminal: "International", floor: "" };
}

describe("matchPoiByGateHint", () => {
  // The map publishes SFO gates zero-padded ("G08 登机口") while the flight
  // reports "G8", so the Time-to-Gate handoff left the destination unselected.
  const sfo = [gate("G01 登机口"), gate("G08 登机口"), gate("G12 登机口")];

  it("matches a zero-padded gate name from an unpadded flight gate", () => {
    expect(matchPoiByGateHint(sfo, "G8")?.name).toBe("G08 登机口");
  });

  it("matches when the flight gate is padded too", () => {
    expect(matchPoiByGateHint(sfo, "G08")?.name).toBe("G08 登机口");
  });

  it("accepts the 'Gate X' spelling", () => {
    expect(matchPoiByGateHint(sfo, "Gate G12")?.name).toBe("G12 登机口");
  });

  it("does not confuse gates that share a number across concourses", () => {
    const pois = [gate("C08 登机口"), gate("G08 登机口")];
    expect(matchPoiByGateHint(pois, "G8")?.name).toBe("G08 登机口");
    expect(matchPoiByGateHint(pois, "C8")?.name).toBe("C08 登机口");
  });

  it("refuses a bare number, which cannot identify a concourse", () => {
    expect(matchPoiByGateHint([gate("C08 登机口"), gate("G08 登机口")], "8")).toBeNull();
  });

  it("keeps working for unpadded names like PEK's", () => {
    expect(matchPoiByGateHint([gate("E21"), gate("E22")], "E21")?.name).toBe("E21");
  });

  it("distinguishes a lettered gate suffix", () => {
    const pois = [gate("G12 登机口"), gate("G12A 登机口")];
    expect(matchPoiByGateHint(pois, "G12A")?.name).toBe("G12A 登机口");
  });

  it("returns null for an unknown or placeholder gate", () => {
    expect(matchPoiByGateHint(sfo, "—")).toBeNull();
    expect(matchPoiByGateHint(sfo, "")).toBeNull();
    expect(matchPoiByGateHint(sfo, "Z99")).toBeNull();
  });

  it("prefers a departure gate over an arrival door with the same code", () => {
    const pois: NavPoi[] = [
      { id: "arr", name: "E19 到达口", category: "arrival", terminal: "T3E", floor: "L3" },
      { id: "dep", name: "E19 登机口", category: "gate", terminal: "T3E", floor: "L2" },
    ];
    expect(matchPoiByGateHint(pois, "E19", { preferCategory: "gate" })?.id).toBe("dep");
  });
});

function poi(partial: Partial<NavPoi> & Pick<NavPoi, "id" | "name" | "category">): NavPoi {
  return { terminal: "", floor: "", ...partial };
}

describe("matchSecurityPoi", () => {
  const pois: NavPoi[] = [
    poi({ id: "s-l2", name: "安检1", category: "security", terminal: "T3E", floor: "L2" }),
    poi({ id: "s-l3", name: "安检2", category: "security", terminal: "T3E", floor: "L3" }),
    poi({ id: "s-other", name: "安检区G", category: "security", terminal: "International", floor: "L3" }),
  ];

  it("prefers the same terminal and floor as the destination gate", () => {
    const gate = poi({ id: "g", name: "E19 登机口", category: "gate", terminal: "T3E", floor: "L2" });
    expect(matchSecurityPoi(pois, gate)?.id).toBe("s-l2");
  });

  it("falls back to the same terminal when the floor does not match", () => {
    const gate = poi({ id: "g", name: "E01 登机口", category: "gate", terminal: "T3E", floor: "L4" });
    expect(matchSecurityPoi(pois, gate)?.id).toBe("s-l2");
  });
});

describe("applyNavPlanPrefill", () => {
  const pois: NavPoi[] = [
    poi({ id: "sec", name: "安检区G", category: "security", terminal: "International", floor: "L3" }),
    poi({ id: "g8", name: "G08 登机口", category: "gate", terminal: "International", floor: "L3" }),
    poi({ id: "g1", name: "G01 登机口", category: "gate", terminal: "International", floor: "L3" }),
    poi({ id: "e21", name: "E21", category: "gate", terminal: "T3E", floor: "L2" }),
  ];

  it("fills destination with the gate and origin with security", () => {
    expect(applyNavPlanPrefill(pois, { toGateHint: "G8" })).toEqual({
      fromId: "sec",
      toId: "g8",
    });
  });

  it("keeps both ends of a transfer and does not force security", () => {
    expect(applyNavPlanPrefill(pois, { fromGateHint: "E21", toGateHint: "G8" })).toEqual({
      fromId: "e21",
      toId: "g8",
    });
  });

  it("leaves both ends empty when no gate is assigned", () => {
    expect(applyNavPlanPrefill(pois, {})).toEqual({ fromId: "", toId: "" });
    expect(applyNavPlanPrefill(pois, { toGateHint: "UNKNOWN" })).toEqual({ fromId: "", toId: "" });
  });

  it("for PEK departures starts at 安检1 and ends at the departure gate", () => {
    const pek: NavPoi[] = [
      poi({ id: "s1", name: "安检1", category: "security", terminal: "T3E", floor: "L2" }),
      poi({ id: "s2", name: "安检2", category: "security", terminal: "T3E", floor: "L3" }),
      poi({ id: "e19", name: "E19 登机口", category: "gate", terminal: "T3E", floor: "L2" }),
      poi({ id: "e01", name: "E01 登机口", category: "gate", terminal: "T3E", floor: "L3" }),
    ];
    expect(applyNavPlanPrefill(pek, { airport: "PEK", toGateHint: "E19" })).toEqual({
      fromId: "s1",
      toId: "e19",
    });
    expect(applyNavPlanPrefill(pek, { airport: "PEK", toGateHint: "E01" })).toEqual({
      fromId: "s1",
      toId: "e01",
    });
    expect(applyNavPlanPrefill(pek, { airport: "PEK" })).toEqual({
      fromId: "s1",
      toId: "",
    });
  });
});
