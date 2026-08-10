import { describe, expect, it } from "vitest";
import {
  calculateTimeToGate,
  securityRange,
} from "./departureTimeEngine";
import {
  AircraftClass,
  CheckedBags,
  CongestionLevel,
  DestinationType,
  PassengerEvent,
  SecurityLane,
  WalkingClass,
  type FlightJourneyInput,
} from "./types";

const now = new Date("2026-08-03T08:00:00Z");
const base: FlightJourneyInput = {
  airportCode: "BOS",
  scheduledGateDeparture: "2026-08-03T13:00:00Z",
  originTimeZone: "America/New_York",
  destinationType: DestinationType.Domestic,
  aircraftClass: AircraftClass.NarrowBody,
  checkedBags: CheckedBags.No,
  securityLane: SecurityLane.Standard,
  terminal: "B",
  gate: "B23",
  walkingClass: WalkingClass.Near,
  remoteStand: false,
};

describe("calculateTimeToGate specification scenarios", () => {
  it("1 domestic, no bags, standard security", () => {
    const result = calculateTimeToGate(base, { now });
    expect(result.components).toEqual({
      checkIn: { min: 0, max: 5 },
      security: { min: 15, max: 30 },
      walkToGate: { min: 5, max: 10 },
      transfer: { min: 0, max: 0 },
      buffer: { min: 5, max: 8 },
    });
    // Center estimate + limited uncertainty, not sum(component_min)..sum(component_max).
    expect(result.expectedTotal).toBe(41);
    expect(result.range.max - result.range.min).toBeLessThanOrEqual(20);
    expect(result.range).toEqual({ min: 35, max: 47 });
  });

  it("2 domestic, checked bags, weekday busy period", () => {
    const result = calculateTimeToGate(
      { ...base, scheduledGateDeparture: "2026-08-03T10:00:00Z", checkedBags: CheckedBags.Yes },
      { now },
    );
    expect(result.congestion).toBe(CongestionLevel.Busy);
    expect(result.components.checkIn).toEqual({ min: 10, max: 22 });
    expect(result.components.security).toEqual({ min: 25, max: 45 });
    // Busy security is the dominant uncertainty; width may exceed 20 without hard truncation.
    expect(result.range.max - result.range.min).toBeLessThanOrEqual(24);
    expect(result.expectedTotal).toBe(66);
  });

  it("3 international wide-body with bags adds five to bag maximum", () => {
    const result = calculateTimeToGate(
      {
        ...base,
        destinationType: DestinationType.International,
        aircraftClass: AircraftClass.WideBody,
        checkedBags: CheckedBags.Yes,
      },
      { now },
    );
    expect(result.components.checkIn).toEqual({ min: 20, max: 45 });
    expect(result.congestion).toBe(CongestionLevel.Busy);
  });

  it("4 international without bags uses zero-to-five check-in", () => {
    const result = calculateTimeToGate(
      { ...base, destinationType: DestinationType.International },
      { now },
    );
    expect(result.components.checkIn).toEqual({ min: 0, max: 5 });
  });

  it("5 applies exact priority and PreCheck reductions with five-minute floor", () => {
    expect(securityRange(CongestionLevel.Normal, SecurityLane.Priority)).toEqual({
      min: 11,
      max: 21,
    });
    expect(securityRange(CongestionLevel.Normal, SecurityLane.PreCheck)).toEqual({
      min: 10,
      max: 20,
    });
    expect(securityRange(CongestionLevel.Light, SecurityLane.PreCheck)).toEqual({
      min: 7,
      max: 13,
    });
  });

  it("6 gate unknown uses the unknown walking range", () => {
    const result = calculateTimeToGate(
      { ...base, gate: null, walkingClass: WalkingClass.Unknown },
      { now },
    );
    expect(result.components.walkToGate).toEqual({ min: 10, max: 20 });
    expect(result.assumptions.join(" ")).toContain("Gate is not assigned");
  });

  it("7 terminal unknown is explicit and never invents a terminal", () => {
    const result = calculateTimeToGate({ ...base, terminal: null }, { now });
    expect(result.assumptions.join(" ")).toContain("Departure terminal is not assigned");
  });

  it("8 uses API boarding time first", () => {
    const result = calculateTimeToGate(
      { ...base, boardingStart: "2026-08-03T12:20:00Z" },
      { now },
    );
    expect(result.boardingTime).toBe("2026-08-03T12:20:00.000Z");
    expect(result.boardingTimeSource).toBe("api");
  });

  it("9 applies all exact boarding fallback offsets", () => {
    const cases: Array<[DestinationType, AircraftClass, string]> = [
      [DestinationType.Domestic, AircraftClass.NarrowBody, "2026-08-03T12:25:00.000Z"],
      [DestinationType.International, AircraftClass.NarrowBody, "2026-08-03T12:15:00.000Z"],
      [DestinationType.International, AircraftClass.WideBody, "2026-08-03T12:05:00.000Z"],
      [DestinationType.International, AircraftClass.Unknown, "2026-08-03T12:10:00.000Z"],
    ];
    for (const [destinationType, aircraftClass, expected] of cases) {
      const result = calculateTimeToGate({ ...base, destinationType, aircraftClass }, { now });
      expect(result.boardingTime).toBe(expected);
      expect(result.boardingTimeSource).toBe("estimated");
    }
  });

  it("10 handles a cross-day boarding fallback in airport local time", () => {
    const result = calculateTimeToGate(
      {
        ...base,
        scheduledGateDeparture: "2026-08-04T00:20:00Z",
        originTimeZone: "Asia/Shanghai",
      },
      { now },
    );
    expect(result.boardingTime).toBe("2026-08-03T23:45:00.000Z");
    expect(result.boardingTimeLocal).toContain("Aug 04");
  });

  it("11 preserves local DST display without naive arithmetic", () => {
    const result = calculateTimeToGate(
      {
        ...base,
        boardingStart: "2026-03-08T07:30:00Z",
        scheduledGateDeparture: "2026-03-08T08:00:00Z",
      },
      { now: new Date("2026-03-08T06:00:00Z") },
    );
    expect(result.boardingTimeLocal).toContain("03:30");
    expect(result.displayTimeZone).toBe("America/New_York");
  });

  it("12 uses unknown-aircraft international minus-fifty fallback", () => {
    const result = calculateTimeToGate(
      { ...base, destinationType: DestinationType.International, aircraftClass: AircraftClass.Unknown },
      { now },
    );
    expect(result.boardingTime).toBe("2026-08-03T12:10:00.000Z");
  });

  it("13 adds exact transfer and uncertainty for train or shuttle", () => {
    const result = calculateTimeToGate(
      { ...base, walkingClass: WalkingClass.Train, remoteStand: true },
      { now },
    );
    expect(result.components.walkToGate).toEqual({ min: 20, max: 40 });
    expect(result.components.transfer).toEqual({ min: 5, max: 15 });
    expect(result.components.buffer).toEqual({ min: 5, max: 8 });
  });

  it("14 always returns min less than or equal to max", () => {
    const variants = [
      base,
      { ...base, checkedBags: CheckedBags.Unknown, gate: null },
      { ...base, destinationType: DestinationType.International, aircraftClass: AircraftClass.VeryLarge },
    ];
    for (const input of variants) {
      const result = calculateTimeToGate(input, { now });
      expect(result.range.min).toBeLessThanOrEqual(result.range.max);
    }
  });

  it("15 calculates recommendation from target, never from now", () => {
    const result = calculateTimeToGate(
      { ...base, boardingStart: "2026-08-03T12:20:00Z" },
      { now },
    );
    expect(result.gateBufferMinutes).toBe(15);
    expect(result.targetGateArrival).toBe("2026-08-03T12:05:00.000Z");
    expect(result.recommendedTerminalEntryStart).toBe("2026-08-03T11:18:00.000Z");
    expect(result.recommendedTerminalEntryEnd).toBe("2026-08-03T11:30:00.000Z");
    expect(result.range.max - result.range.min).toBeLessThanOrEqual(15);
  });

  it("16 excludes dynamically completed departure phases", () => {
    const result = calculateTimeToGate(
      {
        ...base,
        checkedBags: CheckedBags.Yes,
        events: { [PassengerEvent.SecurityComplete]: "2026-08-03T11:00:00Z" },
      },
      { now },
    );
    expect(result.components.checkIn).toEqual({ min: 0, max: 0 });
    expect(result.components.security).toEqual({ min: 0, max: 0 });
    expect(result.breakdown.map((item) => item.stage)).not.toContain("security");
  });

  it("17 omits terminal transfer for ordinary entry-to-gate when shuttle unknown", () => {
    const result = calculateTimeToGate({ ...base, remoteStand: null }, { now });
    expect(result.components.transfer).toEqual({ min: 0, max: 0 });
    expect(result.breakdown.some((item) => item.stage === "transfer")).toBe(false);
  });

  it("18 keeps PreCheck domestic no-bags near the 30–45 planning band", () => {
    const result = calculateTimeToGate(
      { ...base, securityLane: SecurityLane.PreCheck, checkedBags: CheckedBags.No },
      { now },
    );
    expect(result.expectedTotal).toBeGreaterThanOrEqual(28);
    expect(result.expectedTotal).toBeLessThanOrEqual(45);
    expect(result.range.max - result.range.min).toBeLessThanOrEqual(15);
  });
});
