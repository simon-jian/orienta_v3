import {
  FINAL_WALK_RANGES,
  IMMIGRATION_RANGES,
  SEAT_EXIT_RANGES,
  getAirportRules,
} from "./airportRules";
import {
  customsRequiredForProcess,
  effectiveGateArrival,
  effectiveRunwayArrival,
  immigrationRequiredForProcess,
  normalizeFlightJourneyContext,
} from "./flightJourneyContext";
import {
  AircraftClass,
  CheckedBags,
  CongestionLevel,
  DestinationType,
  EstimateConfidence,
  ImmigrationLane,
  PassengerEvent,
  SeatPosition,
  SeatZone,
  type AirportRules,
  type ArrivalEstimate,
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
  minutesBetween,
  narrowTotalRange,
  rangeFromKnownTarget,
  sumExpected,
} from "./timeHelpers";

export interface TimeToExitOptions {
  now?: Date;
  rules?: AirportRules;
}

const ZERO: MinuteRange = { min: 0, max: 0 };

export function classifyArrivalCongestion(context: FlightJourneyContext): CongestionLevel {
  const reference =
    context.estimatedRunwayArrival ??
    context.scheduledRunwayArrival ??
    context.estimatedGateArrival ??
    context.scheduledGateArrival ??
    context.actualRunwayArrival ??
    context.actualGateArrival;
  const escalate =
    context.destinationType === DestinationType.International ||
    context.aircraftClass === AircraftClass.WideBody ||
    context.aircraftClass === AircraftClass.VeryLarge;
  return classifyScheduledCongestion(reference, context.destinationTimeZone, escalate);
}

export function resolveSeatZone(context: FlightJourneyContext): {
  zone: SeatZone;
  mappedFromSeat: boolean;
  unmappableSeat: boolean;
} {
  if (context.seatZone !== SeatZone.Unknown) {
    return { zone: context.seatZone, mappedFromSeat: false, unmappableSeat: false };
  }
  const row = context.arrivalSeat?.match(/\d+/)?.[0];
  if (row && context.effectiveTotalRows) {
    const ratio = Number(row) / context.effectiveTotalRows;
    return {
      zone: ratio <= 0.33 ? SeatZone.Front : ratio <= 0.67 ? SeatZone.Middle : SeatZone.Back,
      mappedFromSeat: true,
      unmappableSeat: false,
    };
  }
  if (row) {
    return { zone: SeatZone.Middle, mappedFromSeat: false, unmappableSeat: true };
  }
  return { zone: SeatZone.Unknown, mappedFromSeat: false, unmappableSeat: false };
}

function seatExitRange(context: FlightJourneyContext, zone: SeatZone): MinuteRange {
  const base = SEAT_EXIT_RANGES[context.aircraftClass][zone];
  if (context.seatPosition === SeatPosition.Middle) return { min: base.min, max: base.max + 1 };
  if (context.seatPosition === SeatPosition.Window) {
    return { min: base.min + 1, max: base.max + 2 };
  }
  return { ...base };
}

function fallbackTaxiRange(context: FlightJourneyContext): MinuteRange {
  if (context.remoteStand === true || context.aircraftClass === AircraftClass.VeryLarge) {
    return { min: 15, max: 35 };
  }
  if (
    context.aircraftClass === AircraftClass.WideBody &&
    context.destinationType === DestinationType.International
  ) {
    return { min: 12, max: 25 };
  }
  if (
    (context.aircraftClass === AircraftClass.Regional ||
      context.aircraftClass === AircraftClass.NarrowBody) &&
    context.destinationType === DestinationType.Domestic
  ) {
    return { min: 8, max: 18 };
  }
  return { min: 10, max: 22 };
}

function baggageCenterRange(context: FlightJourneyContext): MinuteRange {
  if (context.checkedBags === CheckedBags.No) return ZERO;
  const international = context.destinationType === DestinationType.International;
  let range =
    context.checkedBags === CheckedBags.Yes
      ? international
        ? { min: 30, max: 50 }
        : { min: 15, max: 30 }
      : international
        ? { min: 15, max: 40 }
        : context.destinationType === DestinationType.Unknown
          ? { min: 10, max: 30 }
          : { min: 12, max: 25 };
  if (
    context.aircraftClass === AircraftClass.WideBody ||
    context.aircraftClass === AircraftClass.VeryLarge
  ) {
    range = {
      min: range.min + (international ? 0 : 5),
      max: range.max + (international ? 0 : 5),
    };
  } else if (
    context.checkedBags === CheckedBags.Yes &&
    !international &&
    context.aircraftClass === AircraftClass.NarrowBody
  ) {
    // Busy / fuller narrow-body domestic flights lean slightly longer.
    range = { min: 18, max: 32 };
  }
  return range;
}

/** Remaining bag wait after subtracting elapsed time since gate arrival. */
export function remainingBaggageRange(
  context: FlightJourneyContext,
  now: Date,
  atGate: boolean,
): MinuteRange {
  const full = baggageCenterRange(context);
  if (full.min === 0 && full.max === 0) return ZERO;
  const expected = expectedFromRange(full);
  const gateInstant =
    context.actualGateArrival ??
    context.events[PassengerEvent.AtArrivalGate] ??
    (atGate ? effectiveGateArrival(context) : null);
  if (!atGate || !gateInstant || gateInstant > now) return full;
  const elapsed = Math.max(0, Math.round(minutesBetween(gateInstant, now)));
  const remainingExpected = Math.max(0, expected - elapsed);
  if (remainingExpected === 0) return ZERO;
  const half = Math.min(8, Math.ceil((full.max - full.min) / 2));
  return {
    min: Math.max(0, remainingExpected - half),
    max: remainingExpected + half,
  };
}

function precleared(context: FlightJourneyContext): boolean {
  return (
    context.preclearedImmigration === true ||
    context.immigrationLane === ImmigrationLane.Precleared
  );
}

function immigrationRange(
  context: FlightJourneyContext,
  congestion: CongestionLevel,
): MinuteRange {
  if (!immigrationRequiredForProcess(context.arrivalProcessOverride) || precleared(context)) {
    return ZERO;
  }
  if (
    context.immigrationLane === ImmigrationLane.Unknown &&
    (context.aircraftClass === AircraftClass.WideBody ||
      context.aircraftClass === AircraftClass.VeryLarge ||
      congestion === CongestionLevel.Busy ||
      congestion === CongestionLevel.VeryBusy)
  ) {
    return { min: 25, max: 75 };
  }
  return IMMIGRATION_RANGES[context.immigrationLane];
}

function touchdownToDoorRange(
  context: FlightJourneyContext,
  now: Date,
  landed: boolean,
  atGate: boolean,
): { range: MinuteRange; source: EstimateBreakdownItem["source"] } {
  if (atGate) return { range: { min: 2, max: 5 }, source: "airport_rule" };
  const runway = effectiveRunwayArrival(context);
  const gate = effectiveGateArrival(context);
  if (runway && gate && gate > runway) {
    const taxi = landed && gate > now
      ? rangeFromKnownTarget(now, gate, 3)
      : (() => {
          const value = Math.max(0, Math.round(minutesBetween(runway, gate)));
          return { min: value, max: value };
        })();
    return {
      range: { min: taxi.min + 2, max: taxi.max + 5 },
      source: "flight_data",
    };
  }
  const taxi = fallbackTaxiRange(context);
  return {
    range: { min: taxi.min + 2, max: taxi.max + 5 },
    source: "fallback",
  };
}

export function calculateTimeToExit(
  input: FlightJourneyInput,
  options: TimeToExitOptions = {},
): ArrivalEstimate {
  const context = normalizeFlightJourneyContext(input);
  const now = options.now ? new Date(options.now) : new Date();
  const rules = options.rules ?? getAirportRules(context.airportCode);
  const congestion = classifyArrivalCongestion(context);
  const status = context.status?.toLowerCase() ?? "";
  const outside = Boolean(context.events[PassengerEvent.Outside]);
  const bagsCollected = Boolean(context.events[PassengerEvent.BagsCollected]) || outside;
  const offPlane = Boolean(context.events[PassengerEvent.OffPlane]) || bagsCollected;
  const atGate =
    Boolean(context.actualGateArrival) ||
    Boolean(context.events[PassengerEvent.AtArrivalGate]) ||
    /\b(at gate|arrived at gate)\b/.test(status) ||
    offPlane;
  const landed =
    Boolean(context.actualRunwayArrival) ||
    Boolean(context.events[PassengerEvent.Landed]) ||
    /\b(landed|arrived)\b/.test(status) ||
    atGate;
  const assumptions: string[] = [];
  let unknowns = 0;

  const touchdown = outside || offPlane
    ? { range: ZERO, source: "flight_data" as const }
    : touchdownToDoorRange(context, now, landed, atGate);
  const seat = resolveSeatZone(context);
  const seatToAircraftExit = outside || offPlane ? ZERO : seatExitRange(context, seat.zone);
  const needsImmigration = immigrationRequiredForProcess(context.arrivalProcessOverride);
  const needsCustoms = customsRequiredForProcess(context.arrivalProcessOverride);
  const gateToBaggageOrImmigration = outside || bagsCollected
    ? ZERO
    : needsImmigration
      ? { min: 8, max: 18 }
      : context.destinationType === DestinationType.Domestic
        ? { min: 5, max: 12 }
        : { min: 5, max: 14 };
  // Ordinary gate-to-exit walks do not invent a remote-stand shuttle band.
  const remoteTransfer =
    outside || bagsCollected
      ? ZERO
      : context.remoteStand === true
        ? { min: 8, max: 20 }
        : ZERO;
  const immigration =
    outside || bagsCollected ? ZERO : immigrationRange(context, congestion);
  const baggage = outside || bagsCollected ? ZERO : remainingBaggageRange(context, now, atGate);
  const customs =
    outside || bagsCollected || !needsCustoms || precleared(context)
      ? ZERO
      : { min: 5, max: 20 };
  const finalWalk =
    outside
      ? ZERO
      : rules.finalWalkOverrides?.[context.arrivalDestination] ??
        FINAL_WALK_RANGES[context.arrivalDestination];

  if (context.aircraftClass === AircraftClass.Unknown) {
    assumptions.push("Aircraft class is unknown; broad taxi and seat-exit fallbacks are used.");
    unknowns++;
  }
  if (seat.unmappableSeat) {
    assumptions.push("Seat row is retained but total rows are unavailable; middle-zone fallback is used.");
    unknowns++;
  } else if (seat.zone === SeatZone.Unknown) {
    assumptions.push("Seat zone is unknown; the aircraft-class unknown-zone range is used.");
    unknowns++;
  } else if (seat.mappedFromSeat) {
    assumptions.push("Seat zone mapped from row ratio and supplied effective total rows.");
  }
  if (context.arrivalProcessOverride === "unknown") {
    assumptions.push("Arrival process cover is unconfirmed; immigration and customs are omitted from the default estimate.");
    unknowns++;
  }
  if (context.checkedBags === CheckedBags.Unknown && !bagsCollected) {
    assumptions.push("Checked-bag status is unknown; baggage fallback is included.");
    unknowns++;
  }
  if (!context.gate) {
    assumptions.push("Arrival gate is not assigned; no route or gate location is invented.");
    unknowns++;
  }
  if (!context.terminal) {
    assumptions.push("Arrival terminal is not assigned.");
    unknowns++;
  }
  if (congestion === CongestionLevel.Unknown) {
    assumptions.push("Congestion cannot be classified without a valid local arrival reference.");
    unknowns++;
  } else {
    assumptions.push(`Rule-based ${congestion.replace("_", " ")} congestion; not live airport data.`);
  }

  const components = {
    touchdownToGateAndDoor: touchdown.range,
    seatToAircraftExit,
    gateToBaggageOrImmigration,
    remoteTransfer,
    immigration,
    baggage,
    customs,
    finalWalk,
  };
  const stageData: Array<[string, MinuteRange, EstimateBreakdownItem["source"]]> = [
    ["touchdown_to_gate_and_door", touchdown.range, touchdown.source],
    ["seat_to_aircraft_exit", seatToAircraftExit, seat.unmappableSeat ? "fallback" : "airport_rule"],
    ["gate_to_baggage_or_immigration", gateToBaggageOrImmigration, "airport_rule"],
    ["remote_transfer", remoteTransfer, "airport_rule"],
    ["immigration", immigration, context.immigrationLane === ImmigrationLane.Unknown ? "fallback" : "airport_rule"],
    ["baggage", baggage, context.checkedBags === CheckedBags.Unknown ? "fallback" : "airport_rule"],
    ["customs", customs, "airport_rule"],
    ["final_walk", finalWalk, rules.finalWalkOverrides?.[context.arrivalDestination] ? "airport_rule" : "fallback"],
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
  const userFeedback = Boolean(
    context.events[PassengerEvent.OffPlane] ||
      context.events[PassengerEvent.BagsCollected] ||
      context.events[PassengerEvent.Outside],
  );
  const allKeyInputsKnown =
    context.aircraftClass !== AircraftClass.Unknown &&
    seat.zone !== SeatZone.Unknown &&
    context.checkedBags !== CheckedBags.Unknown &&
    Boolean(context.gate);
  const confidence =
    outside || atGate || userFeedback
      ? EstimateConfidence.High
      : allKeyInputsKnown && unknowns <= 2
        ? EstimateConfidence.Medium
        : EstimateConfidence.Low;
  const range = narrowTotalRange(expectedTotal, Object.values(components), confidence, {
    journey: "exit",
    // Use process cover, not destination label: connection without immigration
    // should keep a domestic-like remaining-time band.
    domestic: !needsImmigration && !needsCustoms,
    hasBags: context.checkedBags !== CheckedBags.No && !bagsCollected,
    international: needsImmigration || needsCustoms,
  });
  const runwayReference = effectiveRunwayArrival(context);
  const startsAt =
    !landed && runwayReference && runwayReference > now ? runwayReference : now;
  const earliest = addMinutes(startsAt, range.min);
  const latest = addMinutes(startsAt, range.max);
  const displayTimeZone = context.destinationTimeZone ?? "UTC";

  return {
    kind: "time_to_exit",
    range,
    expectedTotal,
    earliestAt: earliest.toISOString(),
    latestAt: latest.toISOString(),
    confidence,
    congestion,
    assumptions,
    sources: [`airport_rules:${rules.code}`, touchdown.source === "flight_data" ? "flight_data" : "arrival:fallback"],
    breakdown,
    calculatedAt: now.toISOString(),
    displayTimeZone,
    earliestLocal: formatInTimeZone(earliest, displayTimeZone),
    latestLocal: formatInTimeZone(latest, displayTimeZone),
    immigrationRequired: needsImmigration && !precleared(context),
    customsRequired: needsCustoms && !precleared(context),
    arrivalProcessOverride: context.arrivalProcessOverride,
    destination: context.arrivalDestination,
    expectedDestinationTimeStart: earliest.toISOString(),
    expectedDestinationTimeEnd: latest.toISOString(),
    expectedDestinationTimeStartLocal: formatInTimeZone(earliest, displayTimeZone),
    expectedDestinationTimeEndLocal: formatInTimeZone(latest, displayTimeZone),
    isRemainingEstimate: landed || userFeedback,
    components,
  };
}
