import {
  SECURITY_RANGES,
  WALKING_RANGES,
  getAirportRules,
} from "./airportRules";
import { normalizeFlightJourneyContext } from "./flightJourneyContext";
import {
  AircraftClass,
  CheckedBags,
  CongestionLevel,
  DestinationType,
  EstimateConfidence,
  PassengerEvent,
  SecurityLane,
  WalkingClass,
  type AirportRules,
  type DepartureEstimate,
  type EstimateBreakdownItem,
  type FlightJourneyContext,
  type FlightJourneyInput,
  type MinuteRange,
} from "./types";
import {
  addMinutes,
  classifyScheduledCongestion,
  expectedFromRange,
  formatInTimeZone,
  narrowTotalRange,
  sumExpected,
} from "./timeHelpers";

export interface TimeToGateOptions {
  now?: Date;
  rules?: AirportRules;
  gateBufferMinutes?: 15;
}

const ZERO: MinuteRange = { min: 0, max: 0 };

function boardingOffset(context: FlightJourneyContext): number {
  if (context.destinationType !== DestinationType.Domestic) {
    if (
      context.aircraftClass === AircraftClass.WideBody ||
      context.aircraftClass === AircraftClass.VeryLarge
    ) {
      return 55;
    }
    return context.aircraftClass === AircraftClass.Unknown ||
      context.destinationType === DestinationType.Unknown
      ? 50
      : 45;
  }
  return 35;
}

export function resolveBoardingTime(context: FlightJourneyContext): {
  time: Date | null;
  source: "api" | "estimated" | null;
} {
  if (context.boardingStart) return { time: context.boardingStart, source: "api" };
  const departure =
    context.estimatedGateDeparture ??
    context.scheduledGateDeparture ??
    context.actualGateDeparture;
  return departure
    ? { time: addMinutes(departure, -boardingOffset(context)), source: "estimated" }
    : { time: null, source: null };
}

export function classifyDepartureCongestion(
  context: FlightJourneyContext,
): CongestionLevel {
  const reference =
    context.estimatedGateDeparture ??
    context.scheduledGateDeparture ??
    context.boardingStart ??
    context.actualGateDeparture;
  const escalate =
    context.destinationType === DestinationType.International ||
    context.aircraftClass === AircraftClass.WideBody ||
    context.aircraftClass === AircraftClass.VeryLarge;
  return classifyScheduledCongestion(reference, context.originTimeZone, escalate);
}

export function departureBagDropRange(context: FlightJourneyContext): MinuteRange {
  const international = context.destinationType === DestinationType.International;
  let range: MinuteRange;
  if (context.checkedBags === CheckedBags.No) range = { min: 0, max: 5 };
  else if (context.checkedBags === CheckedBags.Yes) {
    range = international
      ? { min: 20, max: 40 }
      : context.destinationType === DestinationType.Unknown
        ? { min: 10, max: 35 }
        : { min: 10, max: 22 };
  } else {
    range = international ? { min: 12, max: 35 } : { min: 8, max: 20 };
    if (context.destinationType === DestinationType.Unknown) range = { min: 8, max: 35 };
  }
  const wide =
    context.aircraftClass === AircraftClass.WideBody ||
    context.aircraftClass === AircraftClass.VeryLarge;
  return { min: range.min, max: range.max + (wide ? 5 : 0) };
}

export function securityRange(
  congestion: CongestionLevel,
  lane: SecurityLane,
): MinuteRange {
  const base =
    congestion === CongestionLevel.Unknown
      ? { min: 10, max: 60 }
      : SECURITY_RANGES[congestion];
  const reduction =
    lane === SecurityLane.Priority ? 0.7 : lane === SecurityLane.PreCheck ? 0.65 : 1;
  return {
    min: Math.max(5, Math.round(base.min * reduction)),
    max: Math.max(5, Math.round(base.max * reduction)),
  };
}

export function calculateTimeToGate(
  input: FlightJourneyInput,
  options: TimeToGateOptions = {},
): DepartureEstimate {
  const context = normalizeFlightJourneyContext(input);
  const now = options.now ? new Date(options.now) : new Date();
  const rules = options.rules ?? getAirportRules(context.airportCode);
  const congestion = classifyDepartureCongestion(context);
  const reachedGate =
    Boolean(context.events[PassengerEvent.AtGate]) ||
    Boolean(context.events[PassengerEvent.Boarded]);
  const clearedSecurity =
    Boolean(context.events[PassengerEvent.SecurityComplete]) || reachedGate;
  const bagDropComplete =
    Boolean(context.events[PassengerEvent.BagDropComplete]) || clearedSecurity;
  const assumptions: string[] = [];
  let unknowns = 0;

  const checkIn = bagDropComplete ? ZERO : departureBagDropRange(context);
  const security = clearedSecurity ? ZERO : securityRange(congestion, context.securityLane);
  let walkingClass = context.walkingClass;
  if (walkingClass === WalkingClass.Unknown && context.gate) {
    walkingClass =
      (context.terminal ? rules.terminalWalkingClass?.[context.terminal] : undefined) ??
      rules.defaultWalkingClass;
  }
  const walkToGate = reachedGate ? ZERO : WALKING_RANGES[walkingClass];
  // Terminal transfer only when the airport graph / walking class proves a real transfer.
  // Ordinary terminal-entry-to-gate journeys must not invent a 0–15 shuttle band.
  const needsTransfer = walkingClass === WalkingClass.Train || context.remoteStand === true;
  const transfer = reachedGate ? ZERO : needsTransfer ? { min: 5, max: 15 } : ZERO;
  const buffer = reachedGate ? ZERO : { min: 5, max: 8 };

  if (context.checkedBags === CheckedBags.Unknown) {
    assumptions.push("Checked-bag status is unknown; the configured fallback range is used.");
    unknowns++;
  }
  if (context.destinationType === DestinationType.Unknown) {
    assumptions.push("Domestic/international status is unknown; the wider bag-drop range is used.");
    unknowns++;
  }
  if (context.securityLane === SecurityLane.Unknown) {
    assumptions.push("Security lane is unknown; no lane reduction is applied.");
    unknowns++;
  }
  if (congestion === CongestionLevel.Unknown) {
    assumptions.push("Congestion cannot be classified without a valid local departure reference.");
    unknowns++;
  } else {
    assumptions.push(`Rule-based ${congestion.replace("_", " ")} congestion; not live airport data.`);
  }
  if (!context.gate) {
    assumptions.push("Gate is not assigned; default unknown walking range is used.");
    unknowns++;
  } else if (context.walkingClass === WalkingClass.Unknown) {
    assumptions.push(`Walking class comes from ${rules.code} terminal/airport configuration.`);
  }
  if (!context.terminal) {
    assumptions.push("Departure terminal is not assigned.");
    unknowns++;
  }
  const components = { checkIn, security, walkToGate, transfer, buffer };
  const stageData: Array<[string, MinuteRange, EstimateBreakdownItem["source"]]> = [
    ["check_in", checkIn, context.checkedBags === CheckedBags.Unknown ? "fallback" : "airport_rule"],
    ["security", security, congestion === CongestionLevel.Unknown ? "fallback" : "airport_rule"],
    ["walk_to_gate", walkToGate, context.walkingClass === WalkingClass.Unknown ? "fallback" : "airport_rule"],
    ["transfer", transfer, "airport_rule"],
    ["buffer", buffer, "airport_rule"],
  ];
  const breakdown = stageData
    .filter(([, range]) => range.min !== 0 || range.max !== 0)
    .map(([stage, range, source]) => ({
      stage,
      range,
      expected: expectedFromRange(range),
      source,
      completed: false as const,
    }));
  const expectedTotal = sumExpected(Object.values(components));
  const { time: boardingTime, source: boardingTimeSource } = resolveBoardingTime(context);
  if (boardingTimeSource === "estimated") assumptions.push("Boarding time estimated from departure time.");
  if (!boardingTime) {
    assumptions.push("Boarding and departure times are unavailable; no terminal-entry clock time is produced.");
    unknowns++;
  }
  const confidence =
    reachedGate || unknowns === 0
      ? EstimateConfidence.High
      : unknowns <= 2
        ? EstimateConfidence.Medium
        : EstimateConfidence.Low;
  const range = narrowTotalRange(expectedTotal, Object.values(components), confidence, {
    journey: "gate",
    domestic: context.destinationType === DestinationType.Domestic,
    hasBags: context.checkedBags !== CheckedBags.No,
    international: context.destinationType === DestinationType.International,
  });
  const gateBufferMinutes = 15 as const;
  const targetGateArrival = boardingTime
    ? addMinutes(boardingTime, -gateBufferMinutes)
    : null;
  const recommendedStart = targetGateArrival
    ? addMinutes(targetGateArrival, -range.max)
    : null;
  const recommendedEnd = targetGateArrival
    ? addMinutes(targetGateArrival, -range.min)
    : null;
  const displayTimeZone = context.originTimeZone ?? "UTC";
  const earliest = addMinutes(now, range.min);
  const latest = addMinutes(now, range.max);
  const local = (date: Date | null) =>
    date ? formatInTimeZone(date, displayTimeZone) : null;

  return {
    kind: "time_to_gate",
    range,
    expectedTotal,
    earliestAt: earliest.toISOString(),
    latestAt: latest.toISOString(),
    confidence,
    congestion,
    assumptions,
    sources: [`airport_rules:${rules.code}`, boardingTimeSource ? `boarding:${boardingTimeSource}` : "boarding:unavailable"],
    breakdown,
    calculatedAt: now.toISOString(),
    displayTimeZone,
    earliestLocal: formatInTimeZone(earliest, displayTimeZone),
    latestLocal: formatInTimeZone(latest, displayTimeZone),
    arrivalProcessOverride: context.arrivalProcessOverride,
    boardingTime: boardingTime?.toISOString() ?? null,
    boardingTimeSource,
    boardingTimeLocal: local(boardingTime),
    gateBufferMinutes,
    targetGateArrival: targetGateArrival?.toISOString() ?? null,
    targetGateArrivalLocal: local(targetGateArrival),
    recommendedTerminalEntryStart: recommendedStart?.toISOString() ?? null,
    recommendedTerminalEntryEnd: recommendedEnd?.toISOString() ?? null,
    recommendedTerminalEntryStartLocal: local(recommendedStart),
    recommendedTerminalEntryEndLocal: local(recommendedEnd),
    components,
  };
}
