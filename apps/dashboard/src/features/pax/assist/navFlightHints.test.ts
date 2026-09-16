import { describe, expect, it, vi } from "vitest";
import { fetchTransfer } from "../api/flightApi";
import type { PaxSession } from "../session";
import {
  currentTripFlightId,
  loadDepartureNavFromFlight,
  mergeLiveDepartureHints,
  selectNavHintsForFlight,
  usableAirportCode,
  usableNavGate,
} from "./navFlightHints";

vi.mock("../api/flightApi", () => ({
  fetchTransfer: vi.fn(),
  fetchClosestFlight: vi.fn(),
}));

function transferSession(activeLeg: "arr" | "dep"): PaxSession {
  return {
    token: "t",
    passenger: {
      id: "P1",
      tenantId: "airchina",
      name: "Guest",
      plan: "free",
      flightId: "CA985",
      gateId: "E19",
    },
    accountType: "temporary",
    plan: "free",
    capabilities: [],
    expiresAt: Date.now() + 60_000,
    trip: {
      intent: "transfer",
      arrivalFlight: "CA986",
      departureFlight: "CA985",
      activeLeg,
    },
  };
}

describe("usableAirportCode / usableNavGate", () => {
  it("accepts an indoor-map departure airport", () => {
    expect(usableAirportCode("sfo")).toBe("SFO");
    expect(usableAirportCode("PEK")).toBe("PEK");
  });

  it("rejects placeholders and airports the map cannot open", () => {
    expect(usableAirportCode("")).toBe("");
    expect(usableAirportCode("—")).toBe("");
    expect(usableAirportCode("XXX")).toBe("");
  });

  it("rejects unassigned gate placeholders", () => {
    expect(usableNavGate("G6")).toBe("G6");
    expect(usableNavGate("UNKNOWN")).toBe("");
    expect(usableNavGate("—")).toBe("");
  });
});

describe("currentTripFlightId / selectNavHintsForFlight", () => {
  it("uses the inbound flight on the arrival tab", () => {
    expect(currentTripFlightId(transferSession("arr"))).toBe("CA986");
  });

  it("uses the outbound flight on the departure tab", () => {
    expect(currentTripFlightId(transferSession("dep"))).toBe("CA985");
  });

  it("does not keep CA986 SFO pins on the CA985 tab", () => {
    expect(
      selectNavHintsForFlight(
        transferSession("dep"),
        { airport: "SFO", to: "G7", flight: "CA986" },
        { airport: "SFO", fromGateHint: "安检区G", toGateHint: "G7", flightId: "CA986" },
        "PEK",
      ),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E19",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });

  it("keeps CA986 Start-nav pins on the CA986 tab", () => {
    expect(
      selectNavHintsForFlight(
        transferSession("arr"),
        { airport: "SFO", to: "G7", flight: "CA986" },
        {},
        "PEK",
      ),
    ).toEqual({
      airport: "SFO",
      fromGateHint: undefined,
      toGateHint: "G7",
      flightId: "CA986",
      activeLeg: "arr",
    });
  });

  it("ignores a leftover URL that has no flight id", () => {
    expect(
      selectNavHintsForFlight(
        transferSession("dep"),
        { airport: "SFO", to: "G7" },
        {},
        "PEK",
      ),
    ).toMatchObject({
      airport: "PEK",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });

  it("treats CA986 and CCA986 as the same Start-nav pin", () => {
    const session = transferSession("arr");
    session.trip = { ...session.trip!, arrivalFlight: "CCA986", departureFlight: "CCA985" };
    expect(
      selectNavHintsForFlight(
        session,
        { airport: "SFO", to: "G7", flight: "CA986" },
        {},
        "PEK",
      ),
    ).toMatchObject({
      airport: "SFO",
      toGateHint: "G7",
      flightId: "CCA986",
      activeLeg: "arr",
    });
  });
});

describe("mergeLiveDepartureHints", () => {
  const current = { airport: "PEK", toGateHint: "E19", flightId: "UA888" };

  it("uses the live departure airport and gate when the URL did not pin them", () => {
    expect(mergeLiveDepartureHints(current, { airport: "SFO", gate: "G6" }, {})).toEqual({
      airport: "SFO",
      fromGateHint: undefined,
      toGateHint: "G6",
      flightId: "UA888",
      activeLeg: undefined,
    });
  });

  it("lets live departure win over leftover URL pins from another flight", () => {
    expect(
      mergeLiveDepartureHints(
        { airport: "SFO", fromGateHint: "安检区G", toGateHint: "G7", flightId: "CA986", activeLeg: "arr" },
        { airport: "PEK", gate: "E12", flightId: "CA985", activeLeg: "dep" },
        { airport: "SFO", to: "G7", flight: "CA986" },
      ),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E12",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });

  it("lets live CA985 PEK win over a URL that omitted flight=", () => {
    expect(
      mergeLiveDepartureHints(
        { airport: "SFO", toGateHint: "G7", flightId: "CA985", activeLeg: "dep" },
        { airport: "PEK", gate: "E12", flightId: "CA985", activeLeg: "dep" },
        { airport: "SFO", to: "G7" },
      ),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E12",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });

  it("applies same-flight Start-nav pins when live lookup has not returned", () => {
    expect(
      mergeLiveDepartureHints(
        { airport: "PEK", flightId: "CA985", activeLeg: "dep" },
        {},
        { airport: "PEK", to: "E21", flight: "CA985" },
      ),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E21",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });

  it("drops a leftover start when live data switches airport", () => {
    expect(
      mergeLiveDepartureHints(
        { airport: "SFO", fromGateHint: "安检区G", toGateHint: "G6", flightId: "UA888" },
        { airport: "PEK", gate: "E19" },
        {},
      ),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E19",
      flightId: "UA888",
      activeLeg: undefined,
    });
  });

  it("switches to the other flight's departure airport and gate when the tab changes", () => {
    expect(
      mergeLiveDepartureHints(
        { airport: "PEK", fromGateHint: "安检1", toGateHint: "E21", flightId: "CA985", activeLeg: "dep" },
        { airport: "SFO", gate: "G7", flightId: "CA986", activeLeg: "arr" },
        {},
      ),
    ).toEqual({
      airport: "SFO",
      fromGateHint: undefined,
      toGateHint: "G7",
      flightId: "CA986",
      activeLeg: "arr",
    });
  });

  it("keeps the current gate when the live flight has none yet", () => {
    expect(mergeLiveDepartureHints(current, { airport: "PEK", gate: "" }, {})).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E19",
      flightId: "UA888",
      activeLeg: undefined,
    });
  });
});

describe("loadDepartureNavFromFlight", () => {
  it("uses CA985's PEK departure, not the hub or CA986's SFO", async () => {
    vi.mocked(fetchTransfer).mockResolvedValue({
      arrival: {
        flight_iata: "CA986",
        dep_iata: "SFO",
        arr_iata: "PEK",
        dep_gate: "G7",
        arr_gate: "E12",
      } as never,
      departure: {
        flight_iata: "CA985",
        dep_iata: "PEK",
        arr_iata: "SFO",
        dep_gate: "E12",
        arr_gate: "G7",
      } as never,
      hub_airport: "PEK",
      from_gate: "E12",
      to_gate: "E21",
    });

    await expect(loadDepartureNavFromFlight(transferSession("dep"))).resolves.toEqual({
      airport: "PEK",
      gate: "E12",
      flightId: "CA985",
      activeLeg: "dep",
    });
  });
});
