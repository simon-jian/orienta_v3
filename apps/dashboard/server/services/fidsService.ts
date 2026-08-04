/**
 * Flight gate/schedule resolution for passenger sessions (P1-7).
 *
 * Strategy: resolve from live FlightAware. When no API key is configured, the
 * lookup fails, or fields are missing, fall back to caller-provided hints (and a
 * generic default gate). No demo/seed schedule is bundled. Results are cached
 * briefly to avoid hammering AeroAPI on every scan.
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
  source: "flightaware" | "fallback";
};

const CACHE_TTL_MS = 5 * 60_000;
/** Last-resort gate when an airport has no defaultGate configured either. */
const GENERIC_FALLBACK_GATE = "UNKNOWN";
const cache = new Map<string, { at: number; value: ResolvedOutbound }>();

/**
 * Fallback used when live FlightAware data is unavailable: caller-provided hints
 * win, otherwise the airport's configured defaultGate (config/airports/*.yaml),
 * else a generic placeholder — and a +90min departure estimate.
 */
function fallbackResolve(
  flightId: string,
  fallbackGateId: string | undefined,
  fallbackTo: string | undefined,
  airportId: string | undefined,
): ResolvedOutbound {
  return {
    flightId,
    gateId: fallbackGateId || getAirportOrDefault(airportId).defaultGate || GENERIC_FALLBACK_GATE,
    outboundTo: fallbackTo || "",
    scheduledDepMs: Date.now() + 90 * 60_000,
    source: "fallback",
  };
}

/**
 * Resolve a passenger's outbound flight from live FlightAware data. Anything
 * FlightAware omits keeps the caller-provided fallback value.
 */
export async function resolveOutbound(
  rawFlightId: string,
  fallbackGateId?: string,
  fallbackTo?: string,
  airportId?: string,
): Promise<ResolvedOutbound> {
  const flightId = normalizeFlight(rawFlightId);
  const fallback = fallbackResolve(flightId, fallbackGateId, fallbackTo, airportId);

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
