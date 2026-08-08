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

export type FidsStatus = "unconfigured" | "ok" | "unavailable";

export type FidsResult = {
  status: FidsStatus;
  flights: FidsFlight[];
};

/** Board refresh interval — matches server cache TTL order of magnitude. */
export const REFRESH_MS = 5 * 60 * 1000;

const UNCONFIGURED: FidsResult = { status: "unconfigured", flights: [] };

async function fetchBoard(path: string, airport?: string): Promise<FidsResult> {
  const q = airport ? `?airport=${encodeURIComponent(airport)}` : "";
  try {
    const res = await fetch(apiUrl(`${path}${q}`), { credentials: "same-origin" });
    const data = (await res.json().catch(() => null)) as FidsResult | null;
    if (!data || typeof data.status !== "string") {
      return res.status === 401 || res.status === 403
        ? UNCONFIGURED
        : { status: "unavailable", flights: [] };
    }
    if (data.status === "unconfigured" || data.status === "ok" || data.status === "unavailable") {
      return {
        status: data.status,
        flights: Array.isArray(data.flights) ? data.flights : [],
      };
    }
    return UNCONFIGURED;
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
