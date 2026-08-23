import { describe, expect, it } from "vitest";
import { matchPoiByGateHint, type NavPoi } from "./navPoiApi";

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
});
