import { describe, expect, it } from "vitest";
import { sameFlightId } from "./flightIdent";

describe("sameFlightId", () => {
  it("matches IATA and ICAO for the same Air China service", () => {
    expect(sameFlightId("CA985", "CCA985")).toBe(true);
    expect(sameFlightId("ca986", "CCA986")).toBe(true);
  });

  it("does not match a different flight number", () => {
    expect(sameFlightId("CA985", "CA986")).toBe(false);
    expect(sameFlightId("CCA985", "CCA986")).toBe(false);
  });
});
