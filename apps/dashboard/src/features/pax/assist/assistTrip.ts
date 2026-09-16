import {
  getStoredPaxTrip,
  type PaxSession,
  type PaxTripContext,
} from "../session";
import type { AssistInfoStrip } from "./assistTypes";

export function resolveAssistTrip(session: PaxSession): PaxTripContext {
  return (
    session.trip ||
    getStoredPaxTrip() || {
      intent: "depart",
      flight: session.passenger.flightId,
    }
  );
}

export function transferFlightIds(session: PaxSession, trip: PaxTripContext): {
  arrival: string;
  departure: string;
} {
  return {
    arrival: trip.arrivalFlight || "",
    departure: trip.departureFlight || session.passenger.flightId || "",
  };
}

/** Flight ids for the info strip — enriched later with FA airport/gate labels. */
export function baseInfoStrip(
  session: PaxSession,
  trip: PaxTripContext,
  extras?: { inboundLabel?: string; outboundLabel?: string; status?: string; gate?: string },
): AssistInfoStrip {
  let inbound = "—";
  let outbound = "—";
  if (trip.intent === "transfer") {
    inbound = trip.arrivalFlight || "—";
    outbound = trip.departureFlight || session.passenger.flightId || "—";
  } else if (trip.intent === "arrive") {
    inbound = trip.flight || session.passenger.flightId || "—";
  } else {
    outbound = trip.flight || session.passenger.flightId || "—";
  }
  return {
    inbound: extras?.inboundLabel || inbound,
    outbound: extras?.outboundLabel || outbound,
    gate: extras?.gate !== undefined ? extras.gate || "—" : session.passenger.gateId || "—",
    status: extras?.status || "—",
    active:
      trip.intent === "transfer"
        ? trip.activeLeg === "dep"
          ? "outbound"
          : "inbound"
        : undefined,
  };
}

export function flightLabel(flightId: string, airport?: string, gate?: string): string {
  const id = (flightId || "").trim();
  if (!id || id === "—") return "—";
  const bits = [id];
  if (airport && airport !== "—") bits.push(airport);
  if (gate && gate !== "—") bits.push(gate);
  return bits.join(" – ");
}
