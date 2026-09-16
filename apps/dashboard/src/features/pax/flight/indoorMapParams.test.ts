import { describe, expect, it } from "vitest";
import { flightMapAirports, indoorMapFloor, indoorMapGateLabel } from "./indoorMapParams";

describe("flightMapAirports", () => {
  it("maps CA986 SFO→PEK as departure SFO and arrival PEK", () => {
    expect(flightMapAirports({ dep_iata: "SFO", arr_iata: "PEK" })).toEqual({ dep: "SFO", arr: "PEK" });
  });

  it("maps CA985 PEK→SFO as departure PEK and arrival SFO", () => {
    expect(flightMapAirports({ dep_iata: "PEK", arr_iata: "SFO" })).toEqual({ dep: "PEK", arr: "SFO" });
  });
});

describe("indoorMapFloor", () => {
  it("pins PEK arrival to L3 and departure to L2", () => {
    expect(indoorMapFloor("PEK", "arr")).toBe("L3");
    expect(indoorMapFloor("PEK", "dep")).toBe("L2");
  });

  it("does not invent a floor for other airports", () => {
    expect(indoorMapFloor("SFO", "arr")).toBeUndefined();
  });
});

describe("indoorMapGateLabel", () => {
  it("disambiguates a bare PEK gate so arrival does not snap to the departure stand", () => {
    expect(indoorMapGateLabel("PEK", "E12", "arr")).toBe("E12 到达口");
    expect(indoorMapGateLabel("PEK", "E12", "dep")).toBe("E12 登机口");
  });

  it("leaves an already-qualified or non-PEK gate alone", () => {
    expect(indoorMapGateLabel("PEK", "E12 到达口", "arr")).toBe("E12 到达口");
    expect(indoorMapGateLabel("SFO", "G5", "dep")).toBe("G5");
  });
});
