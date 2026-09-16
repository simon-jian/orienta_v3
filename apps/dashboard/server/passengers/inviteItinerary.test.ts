import { describe, expect, it } from "vitest";
import {
  inviteFlightLabel,
  isTransferInvite,
  transferHubWarning,
  tripFromInvite,
} from "./inviteItinerary";

describe("invite itinerary helpers", () => {
  it("treats a distinct inbound+outbound pair as a transfer", () => {
    expect(isTransferInvite({ flightId: "CA837", inboundFlight: "CA836" })).toBe(true);
    expect(isTransferInvite({ flightId: "CA837", inboundFlight: "ca837" })).toBe(false);
    expect(isTransferInvite({ flightId: "CA837" })).toBe(false);
  });

  it("labels one flight or both", () => {
    expect(inviteFlightLabel({ flightId: "UA888" })).toBe("UA888");
    expect(inviteFlightLabel({ flightId: "CA837", inboundFlight: "CA836" })).toBe("CA836 / CA837");
  });

  it("builds a transfer trip from a two-flight invite", () => {
    expect(
      tripFromInvite({
        flightId: "CA837",
        flightDate: "2026-09-14",
        leg: "outbound",
        inboundFlight: "CA836",
        inboundDate: "2026-09-13",
      }),
    ).toEqual({
      intent: "transfer",
      arrivalFlight: "CA836",
      departureFlight: "CA837",
      arrivalDate: "2026-09-13",
      departureDate: "2026-09-14",
      activeLeg: "arr",
    });
  });

  it("keeps single-leg arrive/depart trips", () => {
    expect(
      tripFromInvite({
        flightId: "UA888",
        flightDate: "2026-09-14",
        leg: "inbound",
      }),
    ).toEqual({
      intent: "arrive",
      flight: "UA888",
      date: "2026-09-14",
      arrivalFlight: "UA888",
      departureFlight: undefined,
    });
  });

  it("warns when arrival airport is not the departure airport", () => {
    expect(transferHubWarning("PEK", "SFO")).toEqual({
      arrivalAirport: "PEK",
      departureAirport: "SFO",
    });
    expect(transferHubWarning("pek", "PEK")).toBeUndefined();
    expect(transferHubWarning("", "PEK")).toBeUndefined();
  });
});
