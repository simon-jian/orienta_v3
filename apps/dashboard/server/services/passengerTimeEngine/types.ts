/* Intentional aliases (e.g. Deplaned === OffPlane) for engine API clarity. */
/* eslint-disable @typescript-eslint/no-duplicate-enum-values */

export type IsoDateTime = string;

export interface MinuteRange {
  min: number;
  max: number;
}

export enum CheckedBags {
  No = "no",
  None = "no",
  Yes = "yes",
  Checked = "yes",
  Unknown = "unknown",
}

export enum SecurityLane {
  Standard = "standard",
  PreCheck = "precheck",
  Priority = "priority",
  Unknown = "unknown",
}

export enum AircraftClass {
  Regional = "regional",
  NarrowBody = "narrow_body",
  WideBody = "wide_body",
  VeryLarge = "very_large",
  Unknown = "unknown",
}

export enum DestinationType {
  Domestic = "domestic",
  International = "international",
  Unknown = "unknown",
}

/** Provider-neutral arrival process cover for immigration/customs applicability. */
export type ArrivalProcessOverride =
  | "domestic_us"
  | "international_arrival_us"
  | "international_connection"
  | "domestic_other"
  | "unknown";

export enum ImmigrationLane {
  CitizenResident = "citizen_resident",
  Visitor = "visitor",
  GlobalEntry = "global_entry",
  Precleared = "precleared",
  Unknown = "unknown",
}

export enum PassengerEvent {
  BagDropComplete = "bag_drop_complete",
  SecurityComplete = "security_complete",
  AtGate = "at_gate",
  Boarded = "boarded",
  Landed = "landed",
  AtArrivalGate = "at_arrival_gate",
  OffPlane = "off_plane",
  Deplaned = "off_plane",
  BagsCollected = "bags_collected",
  Outside = "outside",
  ExitedAirport = "outside",
}

export enum EstimateConfidence {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export enum CongestionLevel {
  Light = "light",
  Normal = "normal",
  Busy = "busy",
  VeryBusy = "very_busy",
  Unknown = "unknown",
}

export enum SeatZone {
  Front = "front",
  Middle = "middle",
  Back = "back",
  Rear = "back",
  Unknown = "unknown",
}

export enum WalkingClass {
  Near = "near",
  Medium = "medium",
  Far = "far",
  Train = "train",
  Unknown = "unknown",
}

export enum ArrivalDestination {
  TerminalExit = "terminal_exit",
  PickupCurb = "pickup_curb",
  ParkingGarage = "parking_garage",
  Rideshare = "rideshare",
  PublicTransit = "public_transit",
}

export enum SeatPosition {
  Aisle = "aisle",
  Middle = "middle",
  Window = "window",
  Unknown = "unknown",
}

export interface FlightJourneyInput {
  airportCode?: string;
  scheduledGateDeparture?: Date | IsoDateTime | null;
  estimatedGateDeparture?: Date | IsoDateTime | null;
  actualGateDeparture?: Date | IsoDateTime | null;
  scheduledRunwayArrival?: Date | IsoDateTime | null;
  estimatedRunwayArrival?: Date | IsoDateTime | null;
  actualRunwayArrival?: Date | IsoDateTime | null;
  scheduledGateArrival?: Date | IsoDateTime | null;
  estimatedGateArrival?: Date | IsoDateTime | null;
  actualGateArrival?: Date | IsoDateTime | null;
  boardingStart?: Date | IsoDateTime | null;
  originTimeZone?: string | null;
  destinationTimeZone?: string | null;
  terminal?: string | null;
  gate?: string | null;
  aircraftClass?: AircraftClass | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  destinationType?: DestinationType | null;
  arrivalProcessOverride?: ArrivalProcessOverride | null;
  status?: string | null;
  checkedBags?: CheckedBags | null;
  securityLane?: SecurityLane | null;
  immigrationLane?: ImmigrationLane | null;
  seatZone?: SeatZone | null;
  arrivalSeat?: string | null;
  effectiveTotalRows?: number | null;
  seatPosition?: SeatPosition | null;
  walkingClass?: WalkingClass | null;
  arrivalDestination?: ArrivalDestination | null;
  remoteStand?: boolean | null;
  preclearedImmigration?: boolean | null;
  events?: Partial<Record<PassengerEvent, Date | IsoDateTime | null>>;
}

export interface FlightJourneyContext {
  airportCode: string;
  scheduledGateDeparture: Date | null;
  estimatedGateDeparture: Date | null;
  actualGateDeparture: Date | null;
  scheduledRunwayArrival: Date | null;
  estimatedRunwayArrival: Date | null;
  actualRunwayArrival: Date | null;
  scheduledGateArrival: Date | null;
  estimatedGateArrival: Date | null;
  actualGateArrival: Date | null;
  boardingStart: Date | null;
  originTimeZone: string | null;
  destinationTimeZone: string | null;
  terminal: string | null;
  gate: string | null;
  aircraftClass: AircraftClass;
  originCountry: string | null;
  destinationCountry: string | null;
  destinationType: DestinationType;
  arrivalProcessOverride: ArrivalProcessOverride;
  status: string | null;
  checkedBags: CheckedBags;
  securityLane: SecurityLane;
  immigrationLane: ImmigrationLane;
  seatZone: SeatZone;
  arrivalSeat: string | null;
  effectiveTotalRows: number | null;
  seatPosition: SeatPosition;
  walkingClass: WalkingClass;
  arrivalDestination: ArrivalDestination;
  remoteStand: boolean | null;
  preclearedImmigration: boolean | null;
  events: Partial<Record<PassengerEvent, Date>>;
}

export interface AirportRules {
  code: string;
  defaultWalkingClass: WalkingClass;
  terminalWalkingClass?: Readonly<Record<string, WalkingClass>>;
  preclearanceOriginAirports?: readonly string[];
  finalWalkOverrides?: Partial<Record<ArrivalDestination, MinuteRange>>;
}

export interface EstimateBreakdownItem {
  stage: string;
  range: MinuteRange;
  expected: number;
  source: "airport_rule" | "flight_data" | "fallback";
  completed: false;
}

export interface PassengerTimeEstimate {
  kind: "time_to_gate" | "time_to_exit";
  range: MinuteRange;
  expectedTotal: number;
  earliestAt: IsoDateTime;
  latestAt: IsoDateTime;
  confidence: EstimateConfidence;
  congestion: CongestionLevel;
  assumptions: string[];
  sources: string[];
  breakdown: EstimateBreakdownItem[];
  calculatedAt: IsoDateTime;
  displayTimeZone: string;
  earliestLocal: string;
  latestLocal: string;
  immigrationRequired?: boolean;
  customsRequired?: boolean;
  arrivalProcessOverride?: ArrivalProcessOverride;
}

export interface DepartureBreakdown {
  checkIn: MinuteRange;
  security: MinuteRange;
  walkToGate: MinuteRange;
  transfer: MinuteRange;
  buffer: MinuteRange;
}

export interface DepartureEstimate extends PassengerTimeEstimate {
  kind: "time_to_gate";
  boardingTime: IsoDateTime | null;
  boardingTimeSource: "api" | "estimated" | null;
  boardingTimeLocal: string | null;
  gateBufferMinutes: 15;
  targetGateArrival: IsoDateTime | null;
  targetGateArrivalLocal: string | null;
  recommendedTerminalEntryStart: IsoDateTime | null;
  recommendedTerminalEntryEnd: IsoDateTime | null;
  recommendedTerminalEntryStartLocal: string | null;
  recommendedTerminalEntryEndLocal: string | null;
  components: DepartureBreakdown;
}

export interface ArrivalBreakdown {
  touchdownToGateAndDoor: MinuteRange;
  seatToAircraftExit: MinuteRange;
  gateToBaggageOrImmigration: MinuteRange;
  remoteTransfer: MinuteRange;
  immigration: MinuteRange;
  baggage: MinuteRange;
  customs: MinuteRange;
  finalWalk: MinuteRange;
}

export interface ArrivalEstimate extends PassengerTimeEstimate {
  kind: "time_to_exit";
  destination: ArrivalDestination;
  expectedDestinationTimeStart: IsoDateTime;
  expectedDestinationTimeEnd: IsoDateTime;
  expectedDestinationTimeStartLocal: string;
  expectedDestinationTimeEndLocal: string;
  isRemainingEstimate: boolean;
  components: ArrivalBreakdown;
}
