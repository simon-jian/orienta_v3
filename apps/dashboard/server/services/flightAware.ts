/**
 * FlightAware AeroAPI client (shared by flight routes and the FIDS service).
 *
 * Extracted from routes/flight.ts so live flight lookups can be reused for
 * passenger session / gate resolution (P1-7).
 */
import { FLIGHTAWARE_API_KEY } from "../config";

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
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

export async function fetchFlightAware(flightIdent: string): Promise<FlightResult> {
  if (!FLIGHTAWARE_API_KEY) throw new Error("FLIGHTAWARE_API_KEY not configured");

  const utc   = new Date();
  const start = new Date(utc); start.setDate(start.getDate() - 2);
  const end   = new Date(utc); end.setDate(end.getDate() + 2);

  const params = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    max_pages: "1",
  });

  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightIdent)}?${params}`;
  const res = await fetch(url, { headers: { "x-apikey": FLIGHTAWARE_API_KEY, Accept: "application/json" } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }

  const j = await res.json() as Record<string, unknown>;
  const flights = Array.isArray(j.flights) ? j.flights : [];
  if (flights.length === 0) throw new Error(`No flights found for ${flightIdent}`);

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
