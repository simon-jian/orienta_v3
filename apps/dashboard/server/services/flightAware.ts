/**
 * FlightAware AeroAPI client (shared by flight routes and the FIDS service).
 *
 * Extracted from routes/flight.ts so live flight lookups can be reused for
 * passenger session / gate resolution (P1-7).
 */
import { FLIGHTAWARE_API_KEY } from "../config";
import { logger } from "../lib/logger";
import { canonicalFlightId } from "../lib/canonicalize";

export interface FlightResult {
  flight_iata: string;
  dep_iata: string;
  arr_iata: string;
  dep_time_local: string;
  arr_time_local: string;
  dep_scheduled_iso: string | null;
  arr_scheduled_iso: string | null;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  status: string;
}

export function normalizeFlight(s: string): string {
  return canonicalFlightId(s);
}

/** Outbound HTTP timeout. FlightAware is a third party; never let it hang a request. */
const FLIGHTAWARE_TIMEOUT_MS = 8000;

// ─── Circuit breaker ───────────────────────────────────────────────────────────
// Without this, every request/scan during a FlightAware outage (or a quota
// exhaustion returning 429s) still makes a full outbound call and burns
// quota/time — a wasted 8s timeout per request, repeated for every caller.
// After a run of consecutive failures, short-circuit for a cooldown window
// and fail fast; a single trial request after the cooldown decides whether
// to stay open or close again.
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 60_000;
let consecutiveFailures = 0;
let circuitOpenedAt = 0;

function circuitIsOpen(): boolean {
  if (consecutiveFailures < CIRCUIT_FAILURE_THRESHOLD) return false;
  return Date.now() - circuitOpenedAt < CIRCUIT_OPEN_MS;
}

function recordSuccess(): void {
  if (consecutiveFailures > 0) logger.info("flightaware_circuit_closed", { previousFailures: consecutiveFailures });
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures === CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenedAt = Date.now();
    logger.warn("flightaware_circuit_opened", { consecutiveFailures, cooldownMs: CIRCUIT_OPEN_MS });
  } else if (consecutiveFailures > CIRCUIT_FAILURE_THRESHOLD) {
    // The cooldown-elapsed trial request also failed — reopen for another window.
    circuitOpenedAt = Date.now();
  }
}

/** Best-effort visibility for /health or ops tooling; not required for correctness. */
export function flightAwareCircuitStatus(): { open: boolean; consecutiveFailures: number } {
  return { open: circuitIsOpen(), consecutiveFailures };
}

export async function fetchFlightAware(flightIdent: string): Promise<FlightResult> {
  if (!FLIGHTAWARE_API_KEY) throw new Error("FLIGHTAWARE_API_KEY not configured");
  if (circuitIsOpen()) throw new Error("FlightAware circuit open: too many recent failures");
  return fetchFlightAwareUncached(flightIdent);
}

async function fetchFlightAwareUncached(flightIdent: string): Promise<FlightResult> {
  const utc   = new Date();
  const start = new Date(utc); start.setDate(start.getDate() - 2);
  const end   = new Date(utc); end.setDate(end.getDate() + 2);

  const params = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    max_pages: "1",
  });

  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightIdent)}?${params}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-apikey": FLIGHTAWARE_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(FLIGHTAWARE_TIMEOUT_MS),
    });
  } catch (err) {
    // Network error / timeout — genuine evidence the service is unreachable.
    recordFailure();
    throw err;
  }
  if (!res.ok) {
    // Provider-side failure (5xx, 429 quota, 401 bad key, ...) — also counts
    // toward the circuit. A 404 "flight not found" never reaches this branch
    // (AeroAPI returns 200 with an empty `flights` array instead), so a
    // simply-nonexistent flight number does not trip the breaker.
    recordFailure();
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }

  const j = await res.json() as Record<string, unknown>;
  const flights = Array.isArray(j.flights) ? j.flights : [];
  if (flights.length === 0) {
    // The API call itself succeeded — this is a normal "no data for this
    // query" outcome, not a service-health signal, so it does not count as a
    // circuit-breaker failure (also confirms the service is up: reset it).
    recordSuccess();
    throw new Error(`No flights found for ${flightIdent}`);
  }

  const f = flights[0] as Record<string, unknown>;
  const origin = (f.origin as Record<string, unknown>) || {};
  const dest = (f.destination as Record<string, unknown>) || {};

  const isoOf = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const depIso = isoOf(f.scheduled_out) ?? isoOf(f.scheduled_off);
  const arrIso = isoOf(f.scheduled_in) ?? isoOf(f.scheduled_on);

  const toLocal = (iso: string | null, tz: unknown): string => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-CA", {
        timeZone: typeof tz === "string" ? tz : "UTC",
        year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).replace(",", "");
    } catch { return iso.slice(0, 16).replace("T", " "); }
  };

  const str = (v: unknown, fallback = "—"): string =>
    typeof v === "string" && v ? v : fallback;

  const iata = (obj: Record<string, unknown>): string => {
    const v = typeof obj.code_iata === "string" && obj.code_iata ? obj.code_iata : "";
    return v || str(obj.code);
  };

  recordSuccess();
  return {
    flight_iata: f.operator_iata && f.flight_number
      ? `${f.operator_iata}${f.flight_number}`
      : flightIdent,
    dep_iata: iata(origin),
    arr_iata: iata(dest),
    dep_time_local: toLocal(depIso, origin.timezone),
    arr_time_local: toLocal(arrIso, dest.timezone),
    dep_scheduled_iso: depIso,
    arr_scheduled_iso: arrIso,
    dep_terminal: str(f.terminal_origin),
    dep_gate: str(f.gate_origin),
    arr_terminal: str(f.terminal_destination),
    arr_gate: str(f.gate_destination),
    status: str(f.status, "Scheduled"),
  };
}
