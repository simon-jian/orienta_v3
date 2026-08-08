/**
 * Live airport FIDS board (departures / arrivals) for the admin dashboard.
 *
 * Backed by FlightAware AeroAPI airport schedule endpoints. Cached briefly to
 * protect AeroAPI quota; returns status "unconfigured" when no API key is set.
 */
import { FLIGHTAWARE_API_KEY } from "../config";
import { getAirportOrDefault } from "../../src/config/airports/registry";
import { fetchAirportBoard, type AirportBoardFlight, type AirportBoardKind } from "./flightAware";
import { logger } from "../lib/logger";

export type FidsBoardStatus = "unconfigured" | "ok" | "unavailable";

export type FidsBoardResult = {
  status: FidsBoardStatus;
  flights: AirportBoardFlight[];
  airport: string;
  source: "flightaware" | "none";
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: FidsBoardResult }>();

function aeroIdFor(airportHint?: string): { display: string; query: string } {
  const def = getAirportOrDefault(airportHint);
  // AeroAPI prefers ICAO; fall back to IATA / registry id.
  const query = (def.icao || def.iata || def.id || "PEK").toUpperCase();
  const display = (def.iata || def.id || query).toUpperCase();
  return { display, query };
}

export async function fetchFidsBoard(
  kind: AirportBoardKind,
  airportHint?: string,
): Promise<FidsBoardResult> {
  const { display, query } = aeroIdFor(airportHint);

  if (!FLIGHTAWARE_API_KEY) {
    return { status: "unconfigured", flights: [], airport: display, source: "none" };
  }

  const cacheKey = `${kind}:${query}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const flights = await fetchAirportBoard(query, kind);
    const value: FidsBoardResult = {
      status: "ok",
      flights,
      airport: display,
      source: "flightaware",
    };
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn("fids_board_fetch_failed", {
      kind,
      airport: query,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "unavailable", flights: [], airport: display, source: "none" };
  }
}

/** Test helper — clears the in-process board cache. */
export function clearFidsBoardCache(): void {
  cache.clear();
}
