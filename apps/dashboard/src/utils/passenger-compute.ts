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

const UNASSIGNED_GATE = new Set(["", "—", "-", "?", "UNKNOWN", "TBD"]);

/** True when a gate name or id is a real assignment, not a placeholder. */
export function isAssignedGate(...labels: Array<string | null | undefined>): boolean {
  return labels.some((label) => {
    const value = (label ?? "").trim();
    if (!value) return false;
    return !UNASSIGNED_GATE.has(value) && !UNASSIGNED_GATE.has(value.toUpperCase());
  });
}

/** First real gate label (name, then id). Empty when neither is assigned. */
export function preferredGateLabel(
  name?: string | null,
  gateId?: string | null,
): string {
  if (isAssignedGate(name)) return (name ?? "").trim();
  if (isAssignedGate(gateId)) return (gateId ?? "").trim();
  return "";
}

function parseDepartureMs(iso?: string | null): number | null {
  const raw = iso?.trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Passenger outbound time first; flight board time only if that is missing. */
export function resolveDepartureIso(
  outboundDep?: string | null,
  scheduledDep?: string | null,
): string | undefined {
  if (parseDepartureMs(outboundDep) !== null) return outboundDep!.trim();
  if (parseDepartureMs(scheduledDep) !== null) return scheduledDep!.trim();
  return undefined;
}

export function formatDepartureClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Real scheduled/estimated departure, or empty when the clock is unknown.
 * Past departure: time only, no countdown. Never invents check-in or "?".
 */
export function formatDepartureClause(
  iso: string | undefined | null,
  nowMs: number = Date.now(),
): string {
  const depMs = parseDepartureMs(iso);
  if (depMs === null || !iso) return "";
  const clock = formatDepartureClock(iso.trim());
  const mins = Math.round((depMs - nowMs) / 60_000);
  if (mins > 0) {
    const unit = mins === 1 ? "minute" : "minutes";
    return `Scheduled departure is ${clock} (in about ${mins} ${unit}).`;
  }
  return `Scheduled departure is ${clock}.`;
}

function appendClause(text: string, clause: string): string {
  return clause ? `${text} ${clause}` : text;
}

export function defaultSmsTemplate(
  p: PassengerComputed,
  gateName: string,
  flightId: string,
  scheduledDep?: string,
  nowMs: number = Date.now(),
): string {
  const assigned = isAssignedGate(gateName);
  const urgency = p.transfer?.urgency === "urgent" ? " — URGENT" : "";
  const base = assigned
    ? `Orienta: Your flight ${flightId} departs from Gate ${gateName.trim()}${urgency}.`
    : `Orienta: Your flight ${flightId} does not have an assigned gate yet${urgency}.`;
  const depClause = formatDepartureClause(
    resolveDepartureIso(p.transfer?.outboundDep, scheduledDep),
    nowMs,
  );

  if (p.extStatus === "lost" || p.extStatus === "offline") {
    return `${base} We have lost your location. Please reply with your current position (e.g., "near E21 shopping area").`;
  }

  if (p.transfer?.urgency === "urgent" || p.status === "red" || p.status === "yellow") {
    if (assigned) {
      return appendClause(`${base} Please proceed IMMEDIATELY to your gate. Do not stop.`, depClause);
    }
    return appendClause(
      `${base} Please proceed immediately to the terminal. We will update you when a gate is posted.`,
      depClause,
    );
  }

  if (assigned) {
    return appendClause(`${base} Please make your way to the gate.`, depClause);
  }
  if (depClause) {
    return `${base} ${depClause} We will update you when a gate is posted.`;
  }
  return `${base} Please wait for a gate update.`;
}
