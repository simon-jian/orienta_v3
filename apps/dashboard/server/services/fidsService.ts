/**
 * Flight gate/schedule resolution for passenger sessions (P1-7).
 *
 * Strategy: try live FlightAware first; fall back to the static PEK demo
 * schedule when no API key is configured, the lookup fails, or fields are
 * missing. Results are cached briefly to avoid hammering AeroAPI on every scan.
 */
import { FLIGHTAWARE_API_KEY } from "../config";
import { fetchFlightAware, normalizeFlight } from "./flightAware";
import { getAirportOrDefault } from "../../src/config/airports/registry";
import { logger } from "../lib/logger";

export type ResolvedOutbound = {
  flightId: string;
  gateId: string;
  outboundTo: string;
  scheduledDepMs: number;
  source: "flightaware" | "static";
};

const CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_GATE = "E19";
const cache = new Map<string, { at: number; value: ResolvedOutbound }>();

/**
 * Static demo fallback, sourced from the airport registry's demo schedule
 * (Multi-airport Phase 2). The default gate is the hub's default transfer
 * destination gate, falling back to E19 for PEK parity.
 */
function staticResolve(
  flightId: string,
  fallbackGateId: string | undefined,
  fallbackTo: string | undefined,
  airportId: string | undefined,
): ResolvedOutbound {
  const airport = getAirportOrDefault(airportId);
  const defaultGate = airport.demo?.defaultTransferGates?.to ?? DEFAULT_GATE;
  const flight = airport.demo?.outboundFlights?.find((f) => normalizeFlight(f.id) === flightId);
  return {
    flightId,
    gateId: fallbackGateId || flight?.gate || defaultGate,
    outboundTo: flight?.toCity || fallbackTo || "",
    scheduledDepMs: flight ? Date.now() + flight.depOffset * 60_000 : Date.now() + 90 * 60_000,
    source: "static",
  };
}

/**
 * Resolve a passenger's outbound flight. Live data overrides the static demo
 * schedule field-by-field; anything FlightAware omits keeps the static value.
 *
 * `airportId` selects the demo schedule/default gate (defaults to PEK).
 */
export async function resolveOutbound(
  rawFlightId: string,
  fallbackGateId?: string,
  fallbackTo?: string,
  airportId?: string,
): Promise<ResolvedOutbound> {
  const flightId = normalizeFlight(rawFlightId);
  const fallback = staticResolve(flightId, fallbackGateId, fallbackTo, airportId);

  if (!FLIGHTAWARE_API_KEY) return fallback;

  const cacheKey = `${getAirportOrDefault(airportId).id}:${flightId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const inst = await fetchFlightAware(flightId);
    const liveGate = inst.dep_gate && inst.dep_gate !== "—" ? inst.dep_gate.toUpperCase() : "";
    const liveTo = inst.arr_iata && inst.arr_iata !== "—" ? inst.arr_iata : "";
    const liveDepMs = inst.dep_scheduled_iso ? Date.parse(inst.dep_scheduled_iso) : NaN;

    const value: ResolvedOutbound = {
      flightId,
      // Caller-provided gate wins; then live; then static fallback.
      gateId: fallbackGateId || liveGate || fallback.gateId,
      outboundTo: liveTo || fallback.outboundTo,
      scheduledDepMs: Number.isFinite(liveDepMs) ? liveDepMs : fallback.scheduledDepMs,
      source: "flightaware",
    };
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn("fids_live_lookup_failed", { flightId, error: err instanceof Error ? err.message : String(err) });
    return fallback;
  }
}
