import { describe, expect, it } from "vitest";
import { calculateTimeToExit } from "./arrivalTimeEngine";
import {
  AircraftClass,
  ArrivalDestination,
  CheckedBags,
  DestinationType,
  ImmigrationLane,
  PassengerEvent,
  SeatPosition,
  SeatZone,
  type FlightJourneyInput,
} from "./types";

const now = new Date("2026-08-04T23:50:00Z");
const base: FlightJourneyInput = {
  airportCode: "SFO",
  actualGateArrival: "2026-08-04T23:45:00Z",
  destinationTimeZone: "America/Los_Angeles",
  destinationType: DestinationType.Domestic,
  aircraftClass: AircraftClass.NarrowBody,
  checkedBags: CheckedBags.No,
  immigrationLane: ImmigrationLane.Unknown,
  seatZone: SeatZone.Unknown,
  terminal: "3",
  gate: "F20",
  remoteStand: false,
  arrivalDestination: ArrivalDestination.TerminalExit,
};

describe("calculateTimeToExit specification scenarios", () => {
  it("1 in-air flight anchors expected time to future touchdown", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        actualGateArrival: null,
        estimatedRunwayArrival: "2026-08-05T00:20:00Z",
        estimatedGateArrival: "2026-08-05T00:35:00Z",
      },
      { now },
    );
    expect(result.isRemainingEstimate).toBe(false);
    expect(result.expectedDestinationTimeStart >= "2026-08-05T00:20:00.000Z").toBe(true);
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 17, max: 20 });
  });

  it("2 touchdown flight calculates remaining taxi and door time", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        actualGateArrival: null,
        actualRunwayArrival: "2026-08-04T23:45:00Z",
        estimatedGateArrival: "2026-08-05T00:00:00Z",
      },
      { now },
    );
    expect(result.isRemainingEstimate).toBe(true);
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 9, max: 18 });
  });

  it("3 at-gate flight adds only door-opening fallback, not taxi", () => {
    const result = calculateTimeToExit(base, { now });
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 2, max: 5 });
  });

  it("4 domestic no checked bags has zero baggage wait", () => {
    expect(calculateTimeToExit(base, { now }).components.baggage).toEqual({ min: 0, max: 0 });
  });

  it("5 domestic checked bags subtracts elapsed time since gate arrival", () => {
    const result = calculateTimeToExit({ ...base, checkedBags: CheckedBags.Yes }, { now });
    // Full center ~25 min; 5 minutes already elapsed since gate arrival -> remaining ~20.
    expect(result.components.baggage).toEqual({ min: 13, max: 27 });
    expect(result.range.max - result.range.min).toBeLessThanOrEqual(20);
  });

  it("6 international arrival includes immigration and customs", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        originCountry: "GB",
        destinationCountry: "US",
        arrivalProcessOverride: "international_arrival_us",
        destinationType: DestinationType.International,
        immigrationLane: ImmigrationLane.Visitor,
        checkedBags: CheckedBags.Yes,
        preclearedImmigration: false,
      },
      { now },
    );
    expect(result.immigrationRequired).toBe(true);
    expect(result.customsRequired).toBe(true);
    expect(result.components.immigration).toEqual({ min: 25, max: 75 });
    expect(result.components.customs).toEqual({ min: 5, max: 20 });
    expect(result.components.gateToBaggageOrImmigration).toEqual({ min: 8, max: 18 });
  });

  it("7 preclearance removes immigration and customs", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        arrivalProcessOverride: "international_arrival_us",
        destinationType: DestinationType.International,
        immigrationLane: ImmigrationLane.Precleared,
        preclearedImmigration: true,
      },
      { now },
    );
    expect(result.components.immigration).toEqual({ min: 0, max: 0 });
    expect(result.components.customs).toEqual({ min: 0, max: 0 });
  });

  it("8 applies exact front, middle and back narrow-body seat ranges", () => {
    const expected = [
      [SeatZone.Front, { min: 4, max: 8 }],
      [SeatZone.Middle, { min: 8, max: 14 }],
      [SeatZone.Back, { min: 13, max: 22 }],
    ] as const;
    for (const [seatZone, range] of expected) {
      expect(calculateTimeToExit({ ...base, seatZone }, { now }).components.seatToAircraftExit)
        .toEqual(range);
    }
  });

  it("9 maps a parseable seat row using effective total rows", () => {
    const result = calculateTimeToExit(
      { ...base, arrivalSeat: "28A", effectiveTotalRows: 30 },
      { now },
    );
    expect(result.components.seatToAircraftExit).toEqual({ min: 13, max: 22 });
    expect(result.assumptions.join(" ")).toContain("row ratio");
  });

  it("10 retains unmappable seat and uses middle fallback", () => {
    const result = calculateTimeToExit({ ...base, arrivalSeat: "18C" }, { now });
    expect(result.components.seatToAircraftExit).toEqual({ min: 8, max: 14 });
    expect(result.assumptions.join(" ")).toContain("total rows are unavailable");
  });

  it("11 off-plane event removes taxi, door and seat-exit phases", () => {
    const result = calculateTimeToExit(
      { ...base, events: { [PassengerEvent.OffPlane]: "2026-08-04T23:49:00Z" } },
      { now },
    );
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 0, max: 0 });
    expect(result.components.seatToAircraftExit).toEqual({ min: 0, max: 0 });
  });

  it("12 bags-collected event leaves only final destination walk", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        destinationType: DestinationType.International,
        checkedBags: CheckedBags.Yes,
        events: { [PassengerEvent.BagsCollected]: "2026-08-04T23:49:00Z" },
      },
      { now },
    );
    expect(result.breakdown.map((item) => item.stage)).toEqual(["final_walk"]);
    expect(result.expectedTotal).toBe(6);
    expect(result.range).toEqual({ min: 1, max: 11 });
  });

  it("13 outside event returns an exact zero range", () => {
    const result = calculateTimeToExit(
      { ...base, events: { [PassengerEvent.Outside]: "2026-08-04T23:49:00Z" } },
      { now },
    );
    expect(result.range).toEqual({ min: 0, max: 0 });
    expect(result.expectedDestinationTimeStart).toBe(now.toISOString());
    expect(result.expectedDestinationTimeEnd).toBe(now.toISOString());
    expect(result.breakdown).toEqual([]);
  });

  it("14 supports all exact final destination walking ranges", () => {
    const expected: Array<[ArrivalDestination, { min: number; max: number }]> = [
      [ArrivalDestination.TerminalExit, { min: 3, max: 8 }],
      [ArrivalDestination.PickupCurb, { min: 5, max: 12 }],
      [ArrivalDestination.ParkingGarage, { min: 8, max: 18 }],
      [ArrivalDestination.Rideshare, { min: 8, max: 20 }],
      [ArrivalDestination.PublicTransit, { min: 10, max: 25 }],
    ];
    for (const [arrivalDestination, range] of expected) {
      const result = calculateTimeToExit({ ...base, arrivalDestination }, { now });
      expect(result.components.finalWalk).toEqual(range);
      expect(result.destination).toBe(arrivalDestination);
    }
  });

  it("15 gate unknown is explicit and does not invent a route", () => {
    const result = calculateTimeToExit({ ...base, gate: null }, { now });
    expect(result.assumptions.join(" ")).toContain("Arrival gate is not assigned");
  });

  it("16 terminal unknown is explicit", () => {
    const result = calculateTimeToExit({ ...base, terminal: null }, { now });
    expect(result.assumptions.join(" ")).toContain("Arrival terminal is not assigned");
  });

  it("17 remote stand uses exact taxi fallback and transfer ranges", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        actualGateArrival: null,
        scheduledGateArrival: null,
        scheduledRunwayArrival: "2026-08-05T00:20:00Z",
        remoteStand: true,
      },
      { now },
    );
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 17, max: 40 });
    expect(result.components.remoteTransfer).toEqual({ min: 8, max: 20 });
  });

  it("18 handles cross-day and arrival-local timezone display", () => {
    const result = calculateTimeToExit(
      { ...base, destinationTimeZone: "Asia/Shanghai", arrivalDestination: ArrivalDestination.PublicTransit },
      { now },
    );
    expect(result.latestAt.startsWith("2026-08-05")).toBe(true);
    expect(result.latestLocal).toContain("Aug 05");
    expect(result.displayTimeZone).toBe("Asia/Shanghai");
  });

  it("19 always returns min less than or equal to max", () => {
    const variants = [
      base,
      { ...base, aircraftClass: AircraftClass.VeryLarge, checkedBags: CheckedBags.Unknown },
      { ...base, destinationType: DestinationType.International, remoteStand: true },
    ];
    for (const input of variants) {
      const result = calculateTimeToExit(input, { now });
      expect(result.range.min).toBeLessThanOrEqual(result.range.max);
    }
  });

  it("20 never double-counts stages completed by a later event", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        checkedBags: CheckedBags.Yes,
        destinationType: DestinationType.International,
        events: { [PassengerEvent.BagsCollected]: "2026-08-04T23:49:00Z" },
      },
      { now },
    );
    expect(result.breakdown.some((item) => item.stage === "seat_to_aircraft_exit")).toBe(false);
    expect(result.breakdown.some((item) => item.stage === "immigration")).toBe(false);
    expect(result.breakdown.some((item) => item.stage === "baggage")).toBe(false);
  });

  it("21 supports every exact immigration lane", () => {
    const expected = [
      [ImmigrationLane.CitizenResident, { min: 15, max: 45 }],
      [ImmigrationLane.Visitor, { min: 25, max: 75 }],
      [ImmigrationLane.GlobalEntry, { min: 5, max: 20 }],
      [ImmigrationLane.Precleared, { min: 0, max: 0 }],
    ] as const;
    for (const [immigrationLane, range] of expected) {
      const result = calculateTimeToExit(
        {
          ...base,
          originCountry: "GB",
          destinationCountry: "US",
          arrivalProcessOverride: "international_arrival_us",
          destinationType: DestinationType.International,
          immigrationLane,
        },
        { now },
      );
      expect(result.components.immigration).toEqual(range);
    }
  });

  it("22 uses API runway-to-gate difference and adds door once", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        actualGateArrival: null,
        estimatedRunwayArrival: "2026-08-05T00:20:00Z",
        estimatedGateArrival: "2026-08-05T00:32:00Z",
      },
      { now },
    );
    expect(result.components.touchdownToGateAndDoor).toEqual({ min: 14, max: 17 });
    expect(result.sources).toContain("flight_data");
  });

  it("23 wide-body domestic bags use remaining wait after gate elapsed time", () => {
    const result = calculateTimeToExit(
      { ...base, aircraftClass: AircraftClass.WideBody, checkedBags: CheckedBags.Yes },
      { now },
    );
    // Center 28 minus 5 elapsed minutes, with a limited half-width.
    expect(result.components.baggage).toEqual({ min: 15, max: 31 });
  });

  it("24 supports very-large aircraft and reliable window correction", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        aircraftClass: AircraftClass.VeryLarge,
        seatZone: SeatZone.Back,
        seatPosition: SeatPosition.Window,
      },
      { now },
    );
    expect(result.components.seatToAircraftExit).toEqual({ min: 19, max: 32 });
  });

  it("25 domestic US arrivals omit immigration and customs", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        originCountry: "US",
        destinationCountry: "US",
        arrivalProcessOverride: "domestic_us",
        immigrationLane: ImmigrationLane.Visitor,
        checkedBags: CheckedBags.Yes,
      },
      { now },
    );
    expect(result.arrivalProcessOverride).toBe("domestic_us");
    expect(result.immigrationRequired).toBe(false);
    expect(result.customsRequired).toBe(false);
    expect(result.components.immigration).toEqual({ min: 0, max: 0 });
    expect(result.components.customs).toEqual({ min: 0, max: 0 });
    expect(result.breakdown.some((item) => item.stage === "immigration")).toBe(false);
  });

  it("26 unknown process cover does not invent a large immigration band", () => {
    const result = calculateTimeToExit(
      {
        ...base,
        destinationType: DestinationType.Unknown,
        arrivalProcessOverride: "unknown",
        immigrationLane: ImmigrationLane.Unknown,
      },
      { now },
    );
    expect(result.components.immigration).toEqual({ min: 0, max: 0 });
    expect(result.assumptions.join(" ")).toContain("Arrival process cover is unconfirmed");
  });
});
