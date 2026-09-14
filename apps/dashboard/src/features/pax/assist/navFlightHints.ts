import { findNavAirport } from "./navAirports";
import { isAssignedGate } from "../../../utils/passenger-compute";
import { fetchClosestFlight, fetchTransfer } from "../api/flightApi";
import { localCalendarDate, type PaxSession } from "../session";
import { resolveAssistTrip } from "./assistTrip";
import type { NavPlanHints } from "./navPlan";

export function usableAirportCode(value: string | undefined | null): string {
  const code = String(value || "").trim().toUpperCase();
  if (!code || code === "—" || code === "-") return "";
  return findNavAirport(code)?.code || "";
}

export function usableNavGate(value: string | undefined | null): string {
  const gate = (value || "").trim();
  return isAssignedGate(gate) ? gate : "";
}

export function readUrlNavPins(): { airport: string; from: string; to: string } {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      airport: q.get("airport") || "",
      from: q.get("from") || "",
      to: q.get("to") || "",
    };
  } catch {
    return { airport: "", from: "", to: "" };
  }
}

/** URL pins win; otherwise the live departure airport/gate replace tenant defaults. */
export function mergeLiveDepartureHints(
  current: NavPlanHints,
  live: { airport?: string; gate?: string },
  pins: { airport?: string; from?: string; to?: string },
): NavPlanHints {
  const pinnedAirport = usableAirportCode(pins.airport);
  const liveAirport = usableAirportCode(live.airport);
  const pinnedTo = usableNavGate(pins.to);
  const liveGate = usableNavGate(live.gate);
  const pinnedFrom = (pins.from || "").trim();
  const airport = pinnedAirport || liveAirport || current.airport;
  const airportChanged =
    !!(pinnedAirport && current.airport && pinnedAirport !== current.airport) ||
    !!(liveAirport && !pinnedAirport && current.airport && liveAirport !== current.airport);
  return {
    airport,
    // A new departure airport is a new walk — drop the previous airport's
    // start (e.g. SFO 安检区G) or PEK looks like a transfer and skips 安检1.
    fromGateHint: pinnedFrom || (pinnedAirport || airportChanged ? undefined : current.fromGateHint),
    toGateHint: pinnedTo || liveGate || current.toGateHint,
    flightId: current.flightId,
  };
}

export async function loadDepartureNavFromFlight(
  session: PaxSession,
): Promise<{ airport?: string; gate?: string }> {
  const trip = resolveAssistTrip(session);
  if (trip.intent === "transfer") {
    const arr = trip.arrivalFlight || "";
    const dep = trip.departureFlight || session.passenger.flightId;
    if (!arr || !dep) return {};
    const data = await fetchTransfer(arr, dep);
    return {
      airport: usableAirportCode(data.hub_airport) || usableAirportCode(data.departure.dep_iata),
      gate: usableNavGate(data.departure.dep_gate) || usableNavGate(data.to_gate),
    };
  }

  const flight = trip.flight || session.passenger.flightId;
  if (!flight) return {};
  const date = trip.date || localCalendarDate();
  const data = await fetchClosestFlight(flight, date, trip.intent);
  const inst = data.instance;
  if (trip.intent === "arrive") {
    return {
      airport: usableAirportCode(inst.arr_iata) || usableAirportCode(inst.arr_airport_code),
      gate: usableNavGate(inst.arr_gate),
    };
  }
  return {
    airport: usableAirportCode(inst.dep_iata) || usableAirportCode(inst.dep_airport_code),
    gate: usableNavGate(inst.dep_gate),
  };
}
