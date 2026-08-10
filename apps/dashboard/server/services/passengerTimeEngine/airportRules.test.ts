import { describe, expect, it } from "vitest";
import {
  FINAL_WALK_RANGES,
  IMMIGRATION_RANGES,
  SECURITY_RANGES,
  SEAT_EXIT_RANGES,
  WALKING_RANGES,
  getAirportRules,
} from "./airportRules";
import {
  AircraftClass,
  ArrivalDestination,
  CongestionLevel,
  ImmigrationLane,
  SeatZone,
  WalkingClass,
} from "./types";

describe("airportRules exact matrices", () => {
  it("provides DEFAULT, BOS, SFO and PEK rules", () => {
    expect(getAirportRules("xxx").code).toBe("DEFAULT");
    expect(getAirportRules("bos").code).toBe("BOS");
    expect(getAirportRules("SFO").code).toBe("SFO");
    expect(getAirportRules("pek").code).toBe("PEK");
  });

  it("contains exact security and walking ranges", () => {
    expect(SECURITY_RANGES[CongestionLevel.Light]).toEqual({ min: 10, max: 20 });
    expect(SECURITY_RANGES[CongestionLevel.VeryBusy]).toEqual({ min: 35, max: 60 });
    expect(WALKING_RANGES[WalkingClass.Near]).toEqual({ min: 5, max: 10 });
    expect(WALKING_RANGES[WalkingClass.Train]).toEqual({ min: 20, max: 40 });
  });

  it("contains exact very-large and immigration matrices", () => {
    expect(SEAT_EXIT_RANGES[AircraftClass.VeryLarge][SeatZone.Back]).toEqual({
      min: 18,
      max: 30,
    });
    expect(IMMIGRATION_RANGES[ImmigrationLane.CitizenResident]).toEqual({
      min: 15,
      max: 45,
    });
    expect(IMMIGRATION_RANGES[ImmigrationLane.GlobalEntry]).toEqual({ min: 5, max: 20 });
  });

  it("contains exact arrival destination walks", () => {
    expect(FINAL_WALK_RANGES[ArrivalDestination.TerminalExit]).toEqual({ min: 3, max: 8 });
    expect(FINAL_WALK_RANGES[ArrivalDestination.PublicTransit]).toEqual({
      min: 10,
      max: 25,
    });
  });
});
