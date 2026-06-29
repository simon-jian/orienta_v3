import { describe, it, expect } from "vitest";

import { getAirport, getAirportOrDefault, listAirports, DEFAULT_AIRPORT_ID } from "./registry";
import { airportForTenant, getTenant, DEFAULT_TENANT_ID } from "../tenants/registry";
import {
  PEK_OUTBOUND_FLIGHTS,
  PEK_FLIGHT_GATE_MAP,
  PEK_PREMIUM_IDS,
} from "../../data/airports/pek.demo";

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

  it("keeps the PEK definition in sync with canonical demo data", () => {
    const pek = getAirport("PEK")!;
    expect(pek.demo?.outboundFlights).toBe(PEK_OUTBOUND_FLIGHTS);
    expect(pek.demo?.flightGateMap).toBe(PEK_FLIGHT_GATE_MAP);
    expect(pek.demo?.premiumPassengerIds).toBe(PEK_PREMIUM_IDS);
    expect(pek.defaultTerminal).toBe("T3E");
    expect(pek.poi.terminalQuery).toBe("T3E");
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
