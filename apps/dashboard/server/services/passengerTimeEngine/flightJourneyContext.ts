import {
  ArrivalDestination,
  AircraftClass,
  CheckedBags,
  DestinationType,
  ImmigrationLane,
  SecurityLane,
  SeatPosition,
  SeatZone,
  WalkingClass,
  type ArrivalProcessOverride,
  type FlightJourneyContext,
  type FlightJourneyInput,
} from "./types";
import { isValidTimeZone, parseInstant } from "./timeHelpers";

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

export function resolveArrivalProcessOverride(
  input: Pick<
    FlightJourneyInput,
    "arrivalProcessOverride" | "originCountry" | "destinationCountry" | "destinationType"
  >,
): ArrivalProcessOverride {
  if (input.arrivalProcessOverride) return input.arrivalProcessOverride;
  const origin = normalizeCode(input.originCountry);
  const destination = normalizeCode(input.destinationCountry);
  if (origin === "US" && destination === "US") return "domestic_us";
  if (destination === "US" && origin && origin !== "US") return "international_arrival_us";
  if (origin && destination && origin === destination) return "domestic_other";
  if (origin && destination && origin !== destination) return "international_connection";
  if (input.destinationType === DestinationType.Domestic) return "domestic_other";
  if (input.destinationType === DestinationType.International) return "international_connection";
  return "unknown";
}

export function destinationTypeForProcess(
  override: ArrivalProcessOverride,
  destinationType?: DestinationType | null,
): DestinationType {
  if (override === "domestic_us" || override === "domestic_other") {
    return DestinationType.Domestic;
  }
  if (override === "international_arrival_us" || override === "international_connection") {
    return DestinationType.International;
  }
  return destinationType ?? DestinationType.Unknown;
}

export function immigrationRequiredForProcess(override: ArrivalProcessOverride): boolean {
  return override === "international_arrival_us";
}

export function customsRequiredForProcess(override: ArrivalProcessOverride): boolean {
  return override === "international_arrival_us";
}

export function normalizeFlightJourneyContext(input: FlightJourneyInput): FlightJourneyContext {
  const events: FlightJourneyContext["events"] = {};
  for (const [event, value] of Object.entries(input.events ?? {})) {
    const parsed = parseInstant(value);
    if (parsed) events[event as keyof typeof events] = parsed;
  }

  const arrivalProcessOverride = resolveArrivalProcessOverride(input);
  const inferredDestinationType =
    input.destinationType ??
    (input.originCountry && input.destinationCountry
      ? normalizeCode(input.originCountry) === normalizeCode(input.destinationCountry)
        ? DestinationType.Domestic
        : DestinationType.International
      : DestinationType.Unknown);
  const destinationType = destinationTypeForProcess(arrivalProcessOverride, inferredDestinationType);

  return {
    airportCode: normalizeCode(input.airportCode) ?? "DEFAULT",
    scheduledGateDeparture: parseInstant(input.scheduledGateDeparture),
    estimatedGateDeparture: parseInstant(input.estimatedGateDeparture),
    actualGateDeparture: parseInstant(input.actualGateDeparture),
    scheduledRunwayArrival: parseInstant(input.scheduledRunwayArrival),
    estimatedRunwayArrival: parseInstant(input.estimatedRunwayArrival),
    actualRunwayArrival: parseInstant(input.actualRunwayArrival),
    scheduledGateArrival: parseInstant(input.scheduledGateArrival),
    estimatedGateArrival: parseInstant(input.estimatedGateArrival),
    actualGateArrival: parseInstant(input.actualGateArrival),
    boardingStart: parseInstant(input.boardingStart),
    originTimeZone: isValidTimeZone(input.originTimeZone) ? input.originTimeZone : null,
    destinationTimeZone: isValidTimeZone(input.destinationTimeZone)
      ? input.destinationTimeZone
      : null,
    terminal: input.terminal?.trim() || null,
    gate: input.gate?.trim() || null,
    aircraftClass: input.aircraftClass ?? AircraftClass.Unknown,
    originCountry: normalizeCode(input.originCountry),
    destinationCountry: normalizeCode(input.destinationCountry),
    destinationType,
    arrivalProcessOverride,
    status: input.status?.trim() || null,
    checkedBags: input.checkedBags ?? CheckedBags.Unknown,
    securityLane: input.securityLane ?? SecurityLane.Unknown,
    immigrationLane: input.immigrationLane ?? ImmigrationLane.Unknown,
    seatZone: input.seatZone ?? SeatZone.Unknown,
    arrivalSeat: input.arrivalSeat?.trim().toUpperCase() || null,
    effectiveTotalRows:
      input.effectiveTotalRows && input.effectiveTotalRows > 0
        ? Math.floor(input.effectiveTotalRows)
        : null,
    seatPosition: input.seatPosition ?? SeatPosition.Unknown,
    walkingClass: input.walkingClass ?? WalkingClass.Unknown,
    arrivalDestination: input.arrivalDestination ?? ArrivalDestination.TerminalExit,
    remoteStand: input.remoteStand ?? null,
    preclearedImmigration: input.preclearedImmigration ?? null,
    events,
  };
}

export function effectiveDeparture(context: FlightJourneyContext): Date | null {
  return (
    context.actualGateDeparture ??
    context.estimatedGateDeparture ??
    context.scheduledGateDeparture
  );
}

export function effectiveRunwayArrival(context: FlightJourneyContext): Date | null {
  return (
    context.actualRunwayArrival ??
    context.estimatedRunwayArrival ??
    context.scheduledRunwayArrival
  );
}

export function effectiveGateArrival(context: FlightJourneyContext): Date | null {
  return context.actualGateArrival ?? context.estimatedGateArrival ?? context.scheduledGateArrival;
}
