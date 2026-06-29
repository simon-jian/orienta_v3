import { describe, it, expect } from "vitest";

import { getAirport, getAirportOrDefault, listAirports, DEFAULT_AIRPORT_ID } from "./registry";
import { airportForTenant, getTenant, DEFAULT_TENANT_ID } from "../tenants/registry";

describe("airport registry", () => {
  it("resolves PEK by id, IATA, and ICAO (case-insensitive)", () => {
    const byId = getAirport("PEK");
    expect(byId?.id).toBe("PEK");
    expect(getAirport("pek")).toBe(byId);
    expect(getAirport("ZBAA")).toBe(byId);
    expect(getAirport(" zbaa ")).toBe(byId);
  });

  it("returns undefined for unknown airports but a default via getAirportOrDefault", () => {
    expect(getAirport("LHR")).toBeUndefined();
    expect(getAirportOrDefault("LHR").id).toBe(DEFAULT_AIRPORT_ID);
    expect(getAirportOrDefault().id).toBe("PEK");
  });

  it("lists each airport once despite multiple keys", () => {
    expect(listAirports().map((a) => a.id)).toEqual(["PEK"]);
  });

  it("exposes the PEK hub's production config (no demo/seed data)", () => {
    const pek = getAirport("PEK")!;
    expect(pek.defaultTerminal).toBe("T3E");
    expect(pek.poi.terminalQuery).toBe("T3E");
    expect(pek.poi.mode).toBe("indoor_api");
    expect(pek.routeSite?.hubKey).toBe("PEK");
    expect((pek as unknown as { demo?: unknown }).demo).toBeUndefined();
  });
});

describe("tenant registry", () => {
  it("maps airchina → PEK", () => {
    expect(getTenant("airchina")?.airportId).toBe("PEK");
    expect(airportForTenant("airchina")).toBe("PEK");
    expect(airportForTenant("AirChina")).toBe("PEK");
  });

  it("falls back to the default airport for unknown/empty tenants", () => {
    expect(airportForTenant(undefined)).toBe(DEFAULT_AIRPORT_ID);
    expect(airportForTenant("nope")).toBe(DEFAULT_AIRPORT_ID);
    expect(DEFAULT_TENANT_ID).toBe("airchina");
  });
});
