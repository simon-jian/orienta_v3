import { describe, expect, it } from "vitest";
import { mergeLiveDepartureHints, usableAirportCode, usableNavGate } from "./navFlightHints";

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

describe("mergeLiveDepartureHints", () => {
  const current = { airport: "PEK", toGateHint: "E19", flightId: "UA888" };

  it("uses the live departure airport and gate when the URL did not pin them", () => {
    expect(mergeLiveDepartureHints(current, { airport: "SFO", gate: "G6" }, {})).toEqual({
      airport: "SFO",
      fromGateHint: undefined,
      toGateHint: "G6",
      flightId: "UA888",
    });
  });

  it("keeps URL pins over live flight data", () => {
    expect(
      mergeLiveDepartureHints(current, { airport: "SFO", gate: "G6" }, { airport: "PEK", to: "E21" }),
    ).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E21",
      flightId: "UA888",
    });
  });

  it("keeps the current gate when the live flight has none yet", () => {
    expect(mergeLiveDepartureHints(current, { airport: "PEK", gate: "" }, {})).toEqual({
      airport: "PEK",
      fromGateHint: undefined,
      toGateHint: "E19",
      flightId: "UA888",
    });
  });
});
