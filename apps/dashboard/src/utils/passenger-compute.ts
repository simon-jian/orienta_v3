/**
 * Pure passenger computation utilities — ETA, status, SMS template.
 * No sim engine dependency; safe to use anywhere.
 */
import type {
  Gate, Flight, Passenger, PassengerComputed, PassengerStatus,
} from "../types/types";
import { haversineMeters } from "./geo";

export { haversineMeters } from "./geo";

export function computePassenger(
  p: Passenger,
  flight: Flight | null,
  gate: Gate | null
): PassengerComputed {
  if (p.extStatus === "missed") {
    return { ...p, etaMinutes: null, status: "gray", reason: "❌ Flight already departed" };
  }
  if (p.extStatus === "offline") {
    return { ...p, etaMinutes: null, status: "gray", reason: "📵 Offline — no network signal" };
  }
  if (p.extStatus === "lost") {
    return { ...p, etaMinutes: null, status: "gray", reason: "📍 Location lost — awaiting position report" };
  }

  if (!flight || !gate) {
    return { ...p, etaMinutes: null, status: "gray", reason: "Missing flight/gate data" };
  }

  const dep = new Date(flight.scheduledDep).getTime();
  const boardingClose = dep - 10 * 60 * 1000;
  const now = Date.now();
  const minsToClose = (boardingClose - now) / 60_000;

  if (p.activity === "boarded") {
    return { ...p, etaMinutes: 0, status: "green", reason: "✅ Boarded" };
  }
  if (p.activity === "at_gate") {
    const s: PassengerStatus = minsToClose < 2 ? "yellow" : "green";
    return { ...p, etaMinutes: 0, status: s, reason: "✅ At gate" };
  }

  const dist = haversineMeters(p.location, gate.coordinate);
  const speedMps = p.needsWheelchair ? 0.80 : 1.20;
  const etaMin = dist / (speedMps * 60);
  const slack = minsToClose - etaMin;

  let status: PassengerStatus = "green";
  let reason = "On track";

  if (slack < -1) {
    status = "red";
    reason = "⛔ Cannot make flight";
  } else if (slack < 3) {
    status = "yellow";
    reason = "⚠️ Tight connection";
  }

  if (p.activity === "shopping") {
    reason = status === "green" ? "🛍️ Shopping (time OK)" : "🛍️ Shopping (time tight!)";
  } else if (p.activity === "dining") {
    reason = status === "green" ? "🍜 Dining (time OK)" : "🍜 Dining (leave now!)";
  } else if (p.activity === "lounge") {
    reason =
      status === "green"   ? "☕ In lounge (time OK)" :
      status === "yellow"  ? "☕ In lounge (leave soon)" :
                             "☕ In lounge (at risk — go to gate)";
  } else if (p.activity === "idle") {
    reason = status === "green" ? "💺 Resting" : "💺 Resting (move now!)";
  }

  if (p.needsWheelchair) reason += " · ♿ Wheelchair";

  return {
    ...p,
    etaMinutes: Math.max(1, Math.round(etaMin)),
    status,
    reason,
  };
}

export function defaultSmsTemplate(
  p: PassengerComputed,
  gateName: string,
  flightId: string
): string {
  const urgency = p.transfer?.urgency === "urgent" ? " — URGENT" : "";
  const base = `Orienta: Your flight ${flightId} departs from Gate ${gateName}${urgency}.`;
  if (p.extStatus === "lost" || p.extStatus === "offline") {
    return `${base} We have lost your location. Please reply with your current position (e.g., "near E21 shopping area").`;
  }
  if (p.transfer?.urgency === "urgent" || p.status === "red" || p.status === "yellow") {
    return `${base} Please proceed IMMEDIATELY to your gate. Do not stop.`;
  }
  return `${base} Please make your way to the gate. Check-in closes in approx. ${p.etaMinutes ? p.etaMinutes + 10 : "?"} minutes.`;
}
