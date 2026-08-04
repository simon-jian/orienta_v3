import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

import { registerAirport } from "../../config/airports/registry";
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

const PEK_AIRPORT: AirportDefinition = {
  id: "PEK",
  iata: "PEK",
  icao: "ZBAA",
  name: "Beijing Capital International Airport",
  terminals: [{ id: "T3E", label: "T3E" }],
  defaultTerminal: "T3E",
  poi: {
    mode: "indoor_api",
    terminalQuery: "T3E",
    parser: "pek_t3e",
    defaultCenter: { lat: 40.0748162, lng: 116.6061088 },
  },
  map: { indoorMapEnabled: true },
};

beforeAll(() => {
  registerAirport(STATIC_AIRPORT);
  registerAirport(PEK_AIRPORT);
});

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

// Regression coverage for the actual indoor_api ingestion pipeline
// (pekPoiCoords.ts) — the tests above only ever exercise the "before any
// fetch happened" fallback state, never what loadGates()/getGateCoords()
// return once a real POI response has actually been parsed.
describe("PoiService — PEK (indoor_api) after a successful POI fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loadGates('PEK') parses real GeoJSON-shaped features into gate coordinates", async () => {
    vi.resetModules();
    const geoFeatures = [
      {
        properties: { category: "gate", name: "E32", floor: "F3" },
        geometry: { coordinates: [116.61, 40.0751] }, // [lng, lat]
      },
      {
        properties: { category: "gate", name: "Gate E25", floor: "F3" },
        geometry: { coordinates: [116.605, 40.0745] },
      },
      // Not a gate — must be ignored, not crash the parse.
      { properties: { category: "shop", name: "Duty Free" }, geometry: { coordinates: [116.606, 40.0746] } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: geoFeatures }) }),
    );

    const registryMod = await import("../../config/airports/registry");
    const { loadGates: freshLoadGates, getGateCoords: freshGetGateCoords } = await import("./PoiService");
    registryMod.registerAirport(PEK_AIRPORT);

    const { gates, source } = await freshLoadGates("PEK");
    expect(source).toBe("pek_t3e");
    const byId = new Map(gates.map((g) => [g.id, g.coordinate]));
    expect(byId.get("E32")).toEqual({ lat: 40.0751, lng: 116.61 });
    expect(byId.get("E25")).toEqual({ lat: 40.0745, lng: 116.605 }); // "Gate E25" normalized to "E25"
    expect(byId.has("Duty Free")).toBe(false); // non-gate categories excluded

    expect(freshGetGateCoords("PEK")).toEqual({
      E32: { lat: 40.0751, lng: 116.61 },
      E25: { lat: 40.0745, lng: 116.605 },
    });
  });

  it("a failed POI fetch leaves gates empty instead of throwing", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const registryMod = await import("../../config/airports/registry");
    const { loadGates: freshLoadGates } = await import("./PoiService");
    registryMod.registerAirport(PEK_AIRPORT);

    const { gates } = await freshLoadGates("PEK");
    expect(gates).toEqual([]);
  });
});
