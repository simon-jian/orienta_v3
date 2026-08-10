import {
  AircraftClass,
  ArrivalDestination,
  CongestionLevel,
  ImmigrationLane,
  SeatZone,
  WalkingClass,
  type AirportRules,
  type MinuteRange,
} from "./types";

export const SECURITY_RANGES: Record<Exclude<CongestionLevel, CongestionLevel.Unknown>, MinuteRange> = {
  [CongestionLevel.Light]: { min: 10, max: 20 },
  [CongestionLevel.Normal]: { min: 15, max: 30 },
  [CongestionLevel.Busy]: { min: 25, max: 45 },
  [CongestionLevel.VeryBusy]: { min: 35, max: 60 },
};

export const WALKING_RANGES: Record<WalkingClass, MinuteRange> = {
  [WalkingClass.Near]: { min: 5, max: 10 },
  [WalkingClass.Medium]: { min: 10, max: 18 },
  [WalkingClass.Far]: { min: 18, max: 30 },
  [WalkingClass.Train]: { min: 20, max: 40 },
  [WalkingClass.Unknown]: { min: 10, max: 20 },
};

export const SEAT_EXIT_RANGES: Record<AircraftClass, Record<SeatZone, MinuteRange>> = {
  [AircraftClass.Regional]: {
    [SeatZone.Front]: { min: 3, max: 6 },
    [SeatZone.Middle]: { min: 5, max: 9 },
    [SeatZone.Back]: { min: 7, max: 12 },
    [SeatZone.Unknown]: { min: 5, max: 10 },
  },
  [AircraftClass.NarrowBody]: {
    [SeatZone.Front]: { min: 4, max: 8 },
    [SeatZone.Middle]: { min: 8, max: 14 },
    [SeatZone.Back]: { min: 13, max: 22 },
    [SeatZone.Unknown]: { min: 8, max: 16 },
  },
  [AircraftClass.WideBody]: {
    [SeatZone.Front]: { min: 5, max: 10 },
    [SeatZone.Middle]: { min: 10, max: 18 },
    [SeatZone.Back]: { min: 15, max: 25 },
    [SeatZone.Unknown]: { min: 10, max: 20 },
  },
  [AircraftClass.VeryLarge]: {
    [SeatZone.Front]: { min: 6, max: 12 },
    [SeatZone.Middle]: { min: 12, max: 22 },
    [SeatZone.Back]: { min: 18, max: 30 },
    [SeatZone.Unknown]: { min: 14, max: 25 },
  },
  [AircraftClass.Unknown]: {
    [SeatZone.Front]: { min: 4, max: 12 },
    [SeatZone.Middle]: { min: 8, max: 22 },
    [SeatZone.Back]: { min: 13, max: 30 },
    [SeatZone.Unknown]: { min: 5, max: 25 },
  },
};

export const IMMIGRATION_RANGES: Record<ImmigrationLane, MinuteRange> = {
  [ImmigrationLane.CitizenResident]: { min: 15, max: 45 },
  [ImmigrationLane.Visitor]: { min: 25, max: 75 },
  [ImmigrationLane.GlobalEntry]: { min: 5, max: 20 },
  [ImmigrationLane.Precleared]: { min: 0, max: 0 },
  [ImmigrationLane.Unknown]: { min: 20, max: 65 },
};

export const FINAL_WALK_RANGES: Record<ArrivalDestination, MinuteRange> = {
  [ArrivalDestination.TerminalExit]: { min: 3, max: 8 },
  [ArrivalDestination.PickupCurb]: { min: 5, max: 12 },
  [ArrivalDestination.ParkingGarage]: { min: 8, max: 18 },
  [ArrivalDestination.Rideshare]: { min: 8, max: 20 },
  [ArrivalDestination.PublicTransit]: { min: 10, max: 25 },
};

export const DEFAULT_AIRPORT_RULES: AirportRules = {
  code: "DEFAULT",
  defaultWalkingClass: WalkingClass.Unknown,
};

export const BOS_AIRPORT_RULES: AirportRules = {
  code: "BOS",
  defaultWalkingClass: WalkingClass.Medium,
  terminalWalkingClass: { B: WalkingClass.Medium, C: WalkingClass.Far },
};

export const SFO_AIRPORT_RULES: AirportRules = {
  code: "SFO",
  defaultWalkingClass: WalkingClass.Medium,
  terminalWalkingClass: { "1": WalkingClass.Medium, "2": WalkingClass.Medium, "3": WalkingClass.Far },
};

export const PEK_AIRPORT_RULES: AirportRules = {
  code: "PEK",
  defaultWalkingClass: WalkingClass.Far,
  terminalWalkingClass: { T2: WalkingClass.Medium, T3: WalkingClass.Far },
};

export const AIRPORT_RULES: Readonly<Record<string, AirportRules>> = {
  DEFAULT: DEFAULT_AIRPORT_RULES,
  BOS: BOS_AIRPORT_RULES,
  SFO: SFO_AIRPORT_RULES,
  PEK: PEK_AIRPORT_RULES,
};

export function getAirportRules(
  airportCode: string | null | undefined,
  overrides?: Readonly<Record<string, AirportRules>>,
): AirportRules {
  const code = airportCode?.trim().toUpperCase() || "DEFAULT";
  return overrides?.[code] ?? AIRPORT_RULES[code] ?? overrides?.DEFAULT ?? DEFAULT_AIRPORT_RULES;
}
