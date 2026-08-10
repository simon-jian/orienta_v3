/**
 * Maps stored journey preferences + flight instance → passengerTimeEngine input.
 */
import {
  ArrivalDestination,
  CheckedBags,
  DestinationType,
  ImmigrationLane,
  PassengerEvent,
  SecurityLane,
  SeatZone,
  calculateTimeToExit,
  calculateTimeToGate,
  type FlightJourneyInput,
} from "../services/passengerTimeEngine";
import type { JourneyEvent, JourneyPreferences } from "./journeyTypes";
import type { JourneyFlightInstance } from "./journeyFlight";

export type UiCheckedBags = "yes" | "no" | "unknown";
export type UiSecurityLane = "standard" | "trusted" | "precheck" | "priority" | "unknown";
export type UiSeatZone = "front" | "middle" | "rear" | "unknown";
export type UiDestination = "curbside" | "rideshare" | "transit" | "parking" | "unknown";
export type UiImmigration =
  | "not-required"
  | "citizen-resident"
  | "visitor"
  | "global-entry"
  | "unknown";

export type UiJourneyPreferences = {
  checkedBags: UiCheckedBags;
  securityLane: UiSecurityLane;
  seatZone: UiSeatZone;
  destination: UiDestination;
  immigration: UiImmigration;
  boardingBuffer: number;
  targetGateArrival: string | null;
};

const DESTINATION_LABELS: Record<UiDestination, string> = {
  curbside: "Curbside / pickup",
  rideshare: "Rideshare",
  transit: "Public transit",
  parking: "Parking",
  unknown: "Exit",
};

const ARRIVAL_DESTINATIONS: Record<UiDestination, ArrivalDestination> = {
  curbside: ArrivalDestination.PickupCurb,
  rideshare: ArrivalDestination.Rideshare,
  transit: ArrivalDestination.PublicTransit,
  parking: ArrivalDestination.ParkingGarage,
  unknown: ArrivalDestination.TerminalExit,
};

export function destinationLabel(destination: UiDestination): string {
  return DESTINATION_LABELS[destination];
}

export function uiPreferencesFromStored(stored: JourneyPreferences): UiJourneyPreferences {
  const lane = (stored.departureSecurityLane || "").toLowerCase();
  const seat = (stored.arrivalSeatZone || "").toLowerCase();
  const dest = (stored.arrivalDestination || "").toLowerCase();
  const imm = (stored.immigrationLane || "").toLowerCase();
  return {
    checkedBags:
      stored.checkedBags === true ? "yes" : stored.checkedBags === false ? "no" : "unknown",
    securityLane:
      lane === "precheck" || lane === "trusted"
        ? "trusted"
        : lane === "priority"
          ? "priority"
          : lane === "standard"
            ? "standard"
            : "unknown",
    seatZone:
      seat === "front" || seat === "middle" || seat === "rear" || seat === "back"
        ? seat === "back"
          ? "rear"
          : (seat as UiSeatZone)
        : "unknown",
    destination:
      dest === "curbside" || dest === "rideshare" || dest === "transit" || dest === "parking"
        ? dest
        : "unknown",
    immigration:
      imm === "not-required" || imm === "precleared"
        ? "not-required"
        : imm === "citizen_resident" || imm === "citizen-resident"
          ? "citizen-resident"
          : imm === "visitor"
            ? "visitor"
            : imm === "global_entry" || imm === "global-entry"
              ? "global-entry"
              : "unknown",
    boardingBuffer: 20,
    targetGateArrival: null,
  };
}

export function storedUpdateFromUiPatch(patch: Partial<UiJourneyPreferences>): {
  checkedBags?: boolean | null;
  departureSecurityLane?: string | null;
  arrivalSeatZone?: string | null;
  arrivalDestination?: string | null;
  immigrationLane?: string | null;
} {
  return {
    checkedBags:
      patch.checkedBags === undefined
        ? undefined
        : patch.checkedBags === "unknown"
          ? null
          : patch.checkedBags === "yes",
    departureSecurityLane:
      patch.securityLane === undefined
        ? undefined
        : patch.securityLane === "trusted"
          ? "precheck"
          : patch.securityLane,
    arrivalSeatZone: patch.seatZone,
    arrivalDestination: patch.destination,
    immigrationLane:
      patch.immigration === undefined
        ? undefined
        : patch.immigration === "citizen-resident"
          ? "citizen_resident"
          : patch.immigration === "global-entry"
            ? "global_entry"
            : patch.immigration === "not-required"
              ? "precleared"
              : patch.immigration,
  };
}

function resolveArrivalProcessOverride(
  instance: JourneyFlightInstance,
): FlightJourneyInput["arrivalProcessOverride"] {
  const origin = String(instance.origin_country || "").trim().toUpperCase();
  const destination = String(instance.destination_country || "").trim().toUpperCase();
  if (origin === "US" && destination === "US") return "domestic_us";
  if (destination === "US" && origin && origin !== "US") return "international_arrival_us";
  if (origin && destination && origin === destination) return "domestic_other";
  if (origin && destination && origin !== destination) return "international_connection";
  return "unknown";
}

function journeyEventsForEngine(events: JourneyEvent[]): FlightJourneyInput["events"] {
  const mapped: NonNullable<FlightJourneyInput["events"]> = {};
  for (const event of events) {
    const engineEvent =
      event.eventType === "off_plane"
        ? PassengerEvent.Deplaned
        : event.eventType === "bags_collected"
          ? PassengerEvent.BagsCollected
          : PassengerEvent.ExitedAirport;
    mapped[engineEvent] = event.eventTime;
  }
  return mapped;
}

export function buildFlightJourneyInput(
  instance: JourneyFlightInstance,
  preferences: UiJourneyPreferences,
  events: JourneyEvent[],
  kind: "gate" | "exit",
): FlightJourneyInput {
  const arrivalProcessOverride = resolveArrivalProcessOverride(instance);
  const domesticUs = arrivalProcessOverride === "domestic_us";
  return {
    airportCode: kind === "gate" ? instance.dep_iata : instance.arr_iata,
    scheduledGateDeparture: instance.scheduled_out_utc,
    estimatedGateDeparture: instance.estimated_out_utc,
    actualGateDeparture: instance.actual_out_utc,
    scheduledRunwayArrival: instance.scheduled_on_utc,
    estimatedRunwayArrival: instance.estimated_on_utc,
    actualRunwayArrival: instance.actual_on_utc,
    scheduledGateArrival: instance.scheduled_in_utc,
    estimatedGateArrival: instance.estimated_in_utc,
    actualGateArrival: instance.actual_in_utc,
    boardingStart: instance.boarding_time_utc,
    originTimeZone: instance.origin_timezone,
    destinationTimeZone: instance.destination_timezone,
    terminal: kind === "gate" ? instance.dep_terminal : instance.arr_terminal,
    gate: kind === "gate" ? instance.dep_gate : instance.arr_gate,
    aircraftClass: instance.aircraft_class ?? undefined,
    originCountry: instance.origin_country,
    destinationCountry: instance.destination_country,
    arrivalProcessOverride,
    destinationType:
      domesticUs || preferences.immigration === "not-required"
        ? DestinationType.Domestic
        : preferences.immigration === "unknown"
          ? undefined
          : DestinationType.International,
    status: instance.status,
    checkedBags:
      preferences.checkedBags === "yes"
        ? CheckedBags.Yes
        : preferences.checkedBags === "no"
          ? CheckedBags.No
          : CheckedBags.Unknown,
    securityLane:
      preferences.securityLane === "trusted"
        ? SecurityLane.PreCheck
        : preferences.securityLane === "priority"
          ? SecurityLane.Priority
          : preferences.securityLane === "standard"
            ? SecurityLane.Standard
            : SecurityLane.Unknown,
    immigrationLane:
      domesticUs || preferences.immigration === "not-required"
        ? ImmigrationLane.Precleared
        : preferences.immigration === "citizen-resident"
          ? ImmigrationLane.CitizenResident
          : preferences.immigration === "visitor"
            ? ImmigrationLane.Visitor
            : preferences.immigration === "global-entry"
              ? ImmigrationLane.GlobalEntry
              : ImmigrationLane.Unknown,
    preclearedImmigration:
      domesticUs || preferences.immigration === "not-required"
        ? true
        : preferences.immigration === "unknown"
          ? null
          : false,
    seatZone:
      preferences.seatZone === "rear"
        ? SeatZone.Back
        : preferences.seatZone === "front"
          ? SeatZone.Front
          : preferences.seatZone === "middle"
            ? SeatZone.Middle
            : SeatZone.Unknown,
    arrivalDestination: ARRIVAL_DESTINATIONS[preferences.destination],
    events: journeyEventsForEngine(events),
  };
}

export function estimateTimeToGate(
  instance: JourneyFlightInstance,
  preferences: UiJourneyPreferences,
  events: JourneyEvent[],
  now = new Date(),
) {
  return calculateTimeToGate(buildFlightJourneyInput(instance, preferences, events, "gate"), {
    now,
  });
}

export function estimateTimeToExit(
  instance: JourneyFlightInstance,
  preferences: UiJourneyPreferences,
  events: JourneyEvent[],
  now = new Date(),
) {
  return calculateTimeToExit(buildFlightJourneyInput(instance, preferences, events, "exit"), {
    now,
  });
}

export function localRange(earliest: Date, latest: Date, timeZone: string | null | undefined) {
  const zone = timeZone || "UTC";
  const format = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  return { start: format(earliest), end: format(latest), timeZone: zone };
}
