import { describe, expect, it } from "vitest";
import {
  effectiveDeparture,
  effectiveGateArrival,
  immigrationRequiredForProcess,
  normalizeFlightJourneyContext,
  resolveArrivalProcessOverride,
} from "./flightJourneyContext";
import {
  AircraftClass,
  CheckedBags,
  DestinationType,
  PassengerEvent,
} from "./types";

describe("normalizeFlightJourneyContext", () => {
  it("normalizes dates, codes, defaults, and event timestamps", () => {
    const context = normalizeFlightJourneyContext({
      airportCode: " sfo ",
      scheduledGateDeparture: "2026-08-05T00:00:00Z",
      originCountry: " us ",
      destinationCountry: "cn",
      destinationTimeZone: "Asia/Shanghai",
      events: { [PassengerEvent.Landed]: "2026-08-05T12:00:00Z" },
    });
    expect(context.airportCode).toBe("SFO");
    expect(context.scheduledGateDeparture?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(context.destinationType).toBe(DestinationType.International);
    expect(context.aircraftClass).toBe(AircraftClass.Unknown);
    expect(context.checkedBags).toBe(CheckedBags.Unknown);
    expect(context.events[PassengerEvent.Landed]).toBeInstanceOf(Date);
  });

  it("does not retain invalid dates or invent invalid time zones", () => {
    const context = normalizeFlightJourneyContext({
      scheduledGateDeparture: "invalid",
      originTimeZone: "Invalid/Zone",
    });
    expect(context.scheduledGateDeparture).toBeNull();
    expect(context.originTimeZone).toBeNull();
    expect(context.destinationType).toBe(DestinationType.Unknown);
  });

  it("uses actual then estimated then scheduled times", () => {
    const context = normalizeFlightJourneyContext({
      scheduledGateDeparture: "2026-01-01T10:00:00Z",
      estimatedGateDeparture: "2026-01-01T10:10:00Z",
      actualGateDeparture: "2026-01-01T10:12:00Z",
      scheduledGateArrival: "2026-01-01T12:00:00Z",
      estimatedGateArrival: "2026-01-01T12:20:00Z",
    });
    expect(effectiveDeparture(context)?.toISOString()).toContain("10:12:00");
    expect(effectiveGateArrival(context)?.toISOString()).toContain("12:20:00");
  });

  it("classifies BOS→SFO as domestic_us without immigration", () => {
    expect(resolveArrivalProcessOverride({
      originCountry: "US",
      destinationCountry: "US",
    })).toBe("domestic_us");
    expect(immigrationRequiredForProcess("domestic_us")).toBe(false);
    const context = normalizeFlightJourneyContext({
      airportCode: "SFO",
      originCountry: "US",
      destinationCountry: "US",
      destinationType: DestinationType.Domestic,
    });
    expect(context.arrivalProcessOverride).toBe("domestic_us");
    expect(context.destinationType).toBe(DestinationType.Domestic);
  });

  it("honors arrival_process_override for preclearance-like covers", () => {
    const context = normalizeFlightJourneyContext({
      originCountry: "CA",
      destinationCountry: "US",
      arrivalProcessOverride: "domestic_other",
    });
    expect(context.arrivalProcessOverride).toBe("domestic_other");
    expect(immigrationRequiredForProcess(context.arrivalProcessOverride)).toBe(false);
  });
});
