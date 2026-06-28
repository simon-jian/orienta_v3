import { describe, it, expect, beforeAll } from "vitest";

import { register } from "../../config/airports/registry";
import type { AirportDefinition } from "../../config/airports/types";
import { getGateCoords, getGateCoord, getCenter, loadGates } from "./PoiService";

const STATIC_AIRPORT: AirportDefinition = {
  id: "TST",
  iata: "TST",
  name: "Test Static Airport",
  terminals: [{ id: "T1", label: "T1" }],
  defaultTerminal: "T1",
  poi: {
    mode: "static",
    parser: "generic",
    staticGates: { A1: { lat: 1, lng: 2 } },
    defaultCenter: { lat: 10, lng: 20 },
  },
  map: { indoorMapEnabled: false },
};

beforeAll(() => register(STATIC_AIRPORT));

describe("PoiService — static airport dispatch", () => {
  it("serves gates / coord / center from the static config", () => {
    expect(getGateCoords("TST")).toEqual({ A1: { lat: 1, lng: 2 } });
    expect(getGateCoord("A1", "TST")).toEqual({ lat: 1, lng: 2 });
    expect(getGateCoord("nope", "TST")).toBeNull();
    expect(getCenter("TST")).toEqual({ lat: 10, lng: 20 });
  });

  it("loadGates builds Gate[] tagged with the parser as source", async () => {
    const { gates, source } = await loadGates("TST");
    expect(source).toBe("generic");
    expect(gates).toEqual([{ id: "A1", name: "A1", coordinate: { lat: 1, lng: 2 } }]);
  });
});

describe("PoiService — PEK (indoor_api) dispatch", () => {
  it("center falls back to the PEK spine center before POI loads", () => {
    expect(getCenter("PEK")).toEqual({ lat: 40.0748162, lng: 116.6061088 });
  });

  it("gate coords are empty before any POI fetch", () => {
    expect(getGateCoords("PEK")).toEqual({});
  });
});
