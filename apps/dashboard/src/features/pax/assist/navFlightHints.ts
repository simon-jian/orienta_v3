import { findNavAirport } from "./navAirports";
import { isAssignedGate } from "../../../utils/passenger-compute";
import { sameFlightId } from "../../../utils/flightIdent";
import { fetchClosestFlight, fetchTransfer } from "../api/flightApi";
import { localCalendarDate, resolveActiveLeg, type PaxSession } from "../session";
import { resolveAssistTrip } from "./assistTrip";
import type { NavPlanHints } from "./navPlan";

export { sameFlightId };

export function usableAirportCode(value: string | undefined | null): string {
  const code = String(value || "").trim().toUpperCase();
  if (!code || code === "—" || code === "-") return "";
  return findNavAirport(code)?.code || "";
}

export function usableNavGate(value: string | undefined | null): string {
  const gate = (value || "").trim();
  return isAssignedGate(gate) ? gate : "";
}

export function readUrlNavPins(): { airport: string; from: string; to: string; flight: string } {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      airport: q.get("airport") || "",
      from: q.get("from") || "",
      to: q.get("to") || "",
      flight: q.get("flight") || "",
    };
  } catch {
    return { airport: "", from: "", to: "", flight: "" };
  }
}

export function currentTripFlightId(session: PaxSession | null): string | undefined {
  const trip = session?.trip;
  if (!trip) return session?.passenger.flightId;
  if (trip.intent === "transfer") {
    return resolveActiveLeg(trip) === "arr"
      ? trip.arrivalFlight
      : trip.departureFlight || session?.passenger.flightId;
  }
  return trip.flight || session?.passenger.flightId;
}

/** URL / stored pins apply only when they belong to the open flight tab. */
export function selectNavHintsForFlight(
  session: PaxSession | null,
  url: { airport?: string; from?: string; to?: string; flight?: string },
  stored: NavPlanHints,
  defaultAirport: string,
): NavPlanHints {
  const currentFlight = currentTripFlightId(session);
  const urlOk = !!url.flight && !!currentFlight && sameFlightId(url.flight, currentFlight);
  const storedOk = !!stored.flightId && !!currentFlight && sameFlightId(stored.flightId, currentFlight);
  const ownBoardingGate =
    sameFlightId(currentFlight, session?.passenger.flightId) && isAssignedGate(session?.passenger.gateId)
      ? session?.passenger.gateId
      : undefined;
  return {
    airport: (urlOk ? url.airport : undefined) || (storedOk ? stored.airport : undefined) || defaultAirport,
    fromGateHint: (urlOk ? url.from : undefined) || (storedOk ? stored.fromGateHint : undefined),
    toGateHint: (urlOk ? url.to : undefined) || (storedOk ? stored.toGateHint : undefined) || ownBoardingGate,
    flightId: currentFlight || stored.flightId || session?.passenger.flightId,
    activeLeg: session?.trip ? resolveActiveLeg(session.trip) : undefined,
  };
}

/**
 * The open flight's departure wins. URL pins from "Start navigation" are
 * only for that same flight — CA986's ?airport=SFO must not stick on CA985.
 */
export function mergeLiveDepartureHints(
  current: NavPlanHints,
  live: { airport?: string; gate?: string; fromGate?: string; flightId?: string; activeLeg?: "arr" | "dep" },
  pins: { airport?: string; from?: string; to?: string; flight?: string },
): NavPlanHints {
  const flightId = live.flightId || current.flightId;
  const pinsForThisFlight = !!pins.flight && !!flightId && sameFlightId(pins.flight, flightId);
  const pinnedAirport = pinsForThisFlight ? usableAirportCode(pins.airport) : "";
  const liveAirport = usableAirportCode(live.airport);
  const pinnedTo = pinsForThisFlight ? usableNavGate(pins.to) : "";
  const liveGate = usableNavGate(live.gate);
  const pinnedFrom = pinsForThisFlight ? (pins.from || "").trim() : "";
  const airport = liveAirport || pinnedAirport || current.airport;
  const flightChanged = !!(live.flightId && current.flightId && !sameFlightId(live.flightId, current.flightId));
  const legChanged = !!(live.activeLeg && current.activeLeg && live.activeLeg !== current.activeLeg);
  const airportChanged = !!(airport && current.airport && airport !== current.airport);
  const dropStart = airportChanged || flightChanged || legChanged;
  return {
    airport,
    fromGateHint: dropStart ? undefined : pinnedFrom || current.fromGateHint,
    toGateHint:
      liveGate ||
      (liveAirport && dropStart ? undefined : pinnedTo || current.toGateHint) ||
      pinnedTo,
    flightId,
    activeLeg: live.activeLeg || current.activeLeg,
  };
}

export async function loadDepartureNavFromFlight(
  session: PaxSession,
): Promise<{ airport?: string; gate?: string; fromGate?: string; flightId?: string; activeLeg?: "arr" | "dep" }> {
  const trip = resolveAssistTrip(session);
  const activeLeg = resolveActiveLeg(trip);
  if (trip.intent === "transfer") {
    const arr = trip.arrivalFlight || "";
    const dep = trip.departureFlight || session.passenger.flightId;
    if (!arr || !dep) return { activeLeg };
    const data = await fetchTransfer(arr, dep, {
      arrivalDate: trip.arrivalDate,
      departureDate: trip.departureDate,
    });
    const inst = activeLeg === "arr" ? data.arrival : data.departure;
    return {
      airport: usableAirportCode(inst.dep_iata) || usableAirportCode(inst.dep_airport_code),
      gate: usableNavGate(inst.dep_gate),
      flightId: activeLeg === "arr" ? arr : dep,
      activeLeg,
    };
  }

  const flight = trip.flight || session.passenger.flightId;
  if (!flight) return { activeLeg };
  const date = trip.date || localCalendarDate();
  const data = await fetchClosestFlight(flight, date, trip.intent);
  const inst = data.instance;
  return {
    airport: usableAirportCode(inst.dep_iata) || usableAirportCode(inst.dep_airport_code),
    gate: usableNavGate(inst.dep_gate),
    flightId: flight,
    activeLeg,
  };
}
