/**
 * Dashboard FIDS board (departures / arrivals).
 *
 * Fetches the admin `/api/fids/*` board, which is backed by FlightAware AeroAPI
 * when `FLIGHTAWARE_API_KEY` is set. Without a key the server reports
 * `unconfigured` and the panel renders that distinctly from an empty board.
 */
import { apiUrl } from "../config/api";

export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

/**
 * `unauthenticated` is deliberately distinct from `unconfigured`: a 401 used to
 * be reported as "no flight data source configured", which sent debugging after
 * FLIGHTAWARE_API_KEY while the real cause was a rejected admin session (the
 * board never even reached the provider).
 */
export type FidsStatus = "unconfigured" | "ok" | "unavailable" | "unauthenticated";

export type FidsResult = {
  status: FidsStatus;
  flights: FidsFlight[];
};

/** Board refresh interval — matches server cache TTL order of magnitude. */
export const REFRESH_MS = 5 * 60 * 1000;

const SERVER_STATUSES = new Set<FidsStatus>(["unconfigured", "ok", "unavailable"]);

export async function fetchBoard(path: string, airport?: string): Promise<FidsResult> {
  const q = airport ? `?airport=${encodeURIComponent(airport)}` : "";
  try {
    const res = await fetch(apiUrl(`${path}${q}`), { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) {
      return { status: "unauthenticated", flights: [] };
    }
    const data = (await res.json().catch(() => null)) as FidsResult | null;
    if (!data || typeof data.status !== "string" || !SERVER_STATUSES.has(data.status)) {
      return { status: "unavailable", flights: [] };
    }
    return {
      status: data.status,
      flights: Array.isArray(data.flights) ? data.flights : [],
    };
  } catch {
    return { status: "unavailable", flights: [] };
  }
}

export async function fetchDepartures(airport?: string): Promise<FidsResult> {
  return fetchBoard("/api/fids/departures", airport);
}

export async function fetchArrivals(airport?: string): Promise<FidsResult> {
  return fetchBoard("/api/fids/arrivals", airport);
}
