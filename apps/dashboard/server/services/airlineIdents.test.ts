import { describe, expect, it } from "vitest";
import { aeroApiIdentCandidates, icaoFlightIdent } from "./airlineIdents";

describe("icaoFlightIdent", () => {
  it("maps Air China IATA CA5285 to the FlightAware ident CCA5285", () => {
    expect(icaoFlightIdent("CA5285")).toBe("CCA5285");
  });

  it("leaves an ICAO designator unchanged", () => {
    expect(icaoFlightIdent("CCA5285")).toBeUndefined();
    expect(aeroApiIdentCandidates("CCA5285")).toEqual(["CCA5285"]);
  });
});

describe("aeroApiIdentCandidates", () => {
  it("tries ICAO before IATA", () => {
    expect(aeroApiIdentCandidates("CA5285")).toEqual(["CCA5285", "CA5285"]);
    expect(aeroApiIdentCandidates("UA888")).toEqual(["UAL888", "UA888"]);
  });

  it("does not invent a second ident for an unknown airline", () => {
    expect(aeroApiIdentCandidates("ZZ0000")).toEqual(["ZZ0000"]);
  });
});
