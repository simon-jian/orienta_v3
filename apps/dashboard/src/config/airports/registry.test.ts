import { describe, it, expect, beforeEach } from "vitest";

import {
  setAirports,
  getAirport,
  getAirportOrDefault,
  listAirports,
  defaultAirportId,
} from "./registry";
import {
  setTenants,
  airportForTenant,
  getTenant,
  defaultTenantId,
} from "../tenants/registry";
import type { AirportDefinition } from "./types";

const PEK: AirportDefinition = {
  id: "PEK",
  iata: "PEK",
  icao: "ZBAA",
  name: "Beijing Capital International Airport",
  terminals: [{ id: "T3E", label: "T3E" }],
  defaultTerminal: "T3E",
  poi: { mode: "indoor_api", terminalQuery: "T3E", parser: "pek_t3e", defaultCenter: { lat: 40.07, lng: 116.6 } },
  map: { indoorMapEnabled: true },
};

describe("airport registry (hydrated)", () => {
  beforeEach(() => {
    setAirports([PEK], { defaultId: "PEK" });
    setTenants([{ id: "airchina", airportId: "PEK", displayName: "Air China" }], { defaultId: "airchina" });
  });

  it("resolves a hub by id, IATA, and ICAO (case-insensitive)", () => {
    const byId = getAirport("PEK");
    expect(byId?.id).toBe("PEK");
    expect(getAirport("pek")).toBe(byId);
    expect(getAirport("ZBAA")).toBe(byId);
    expect(getAirport(" zbaa ")).toBe(byId);
  });

  it("returns undefined for unknown airports but a default via getAirportOrDefault", () => {
    expect(getAirport("LHR")).toBeUndefined();
    expect(getAirportOrDefault("LHR").id).toBe(defaultAirportId());
    expect(getAirportOrDefault().id).toBe("PEK");
  });

  it("lists each airport once despite multiple keys", () => {
    expect(listAirports().map((a) => a.id)).toEqual(["PEK"]);
  });

  it("compiles the configured default hub id", () => {
    expect(defaultAirportId()).toBe("PEK");
  });
});

describe("tenant registry (hydrated)", () => {
  beforeEach(() => {
    setAirports([PEK], { defaultId: "PEK" });
    setTenants([{ id: "airchina", airportId: "PEK", displayName: "Air China" }], { defaultId: "airchina" });
  });

  it("maps airchina → PEK", () => {
    expect(getTenant("airchina")?.airportId).toBe("PEK");
    expect(airportForTenant("airchina")).toBe("PEK");
    expect(airportForTenant("AirChina")).toBe("PEK");
  });

  it("falls back to the default airport for unknown/empty tenants", () => {
    expect(airportForTenant(undefined)).toBe(defaultAirportId());
    expect(airportForTenant("nope")).toBe(defaultAirportId());
    expect(defaultTenantId()).toBe("airchina");
  });
});
