/**
 * FlightAware AeroAPI client (shared by flight routes and the FIDS service).
 *
 * Extracted from routes/flight.ts so live flight lookups can be reused for
 * passenger session / gate resolution (P1-7). Rich instance fields + date/intent
 * selection are aligned with robots `apiRoutes.ts` for the passenger flight card.
 */
import { FLIGHTAWARE_API_KEY } from "../config";
import { logger } from "../lib/logger";
import { canonicalFlightId } from "../lib/canonicalize";
import { aeroApiIdentCandidates } from "./airlineIdents";

export type FlightLookupIntent = "depart" | "arrive";

export interface FlightResult {
  flight_iata: string;
  dep_iata: string;
  arr_iata: string;
  dep_airport_code: string;
  arr_airport_code: string;
  dep_time_local: string;
  arr_time_local: string;
  dep_estimated_local: string;
  arr_estimated_local: string;
  dep_actual_local: string;
  arr_actual_local: string;
  dep_scheduled_iso: string | null;
  arr_scheduled_iso: string | null;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  baggage_claim: string;
  duration_minutes: number | null;
  departure_delay_minutes: number | null;
  arrival_delay_minutes: number | null;
  fa_flight_id: string;
  dep_airport_name: string;
  arr_airport_name: string;
  selected_date: string | undefined;
  status: string;
  scheduled_out_utc: string | null;
  estimated_out_utc: string | null;
  actual_out_utc: string | null;
  scheduled_off_utc: string | null;
  estimated_off_utc: string | null;
  actual_off_utc: string | null;
  scheduled_on_utc: string | null;
  estimated_on_utc: string | null;
  actual_on_utc: string | null;
  scheduled_in_utc: string | null;
  estimated_in_utc: string | null;
  actual_in_utc: string | null;
  origin_timezone: string | null;
  destination_timezone: string | null;
  origin_country: string | null;
  destination_country: string | null;
  boarding_time_utc: string | null;
  boarding_time_source: string | null;
}

export type FetchFlightAwareOptions = {
  date?: string;
  intent?: FlightLookupIntent;
};

export function normalizeFlight(s: string): string {
  return canonicalFlightId(s);
}

/** Outbound HTTP timeout. FlightAware is a third party; never let it hang a request. */
const FLIGHTAWARE_TIMEOUT_MS = 8000;

// ─── Circuit breaker ───────────────────────────────────────────────────────────
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
    circuitOpenedAt = Date.now();
  }
}

/** Best-effort visibility for /health or ops tooling; not required for correctness. */
export function flightAwareCircuitStatus(): { open: boolean; consecutiveFailures: number } {
  return { open: circuitIsOpen(), consecutiveFailures };
}

const AIRPORT_COUNTRIES: Record<string, string> = {
  PEK: "CN",
  ZBAA: "CN",
  SFO: "US",
  KSFO: "US",
  BOS: "US",
  KBOS: "US",
};

export function normalizeFlightDate(value: unknown): string | undefined {
  const date = String(value || "").trim();
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? undefined : date;
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

const MS_PER_DAY = 86_400_000;

/**
 * AeroAPI `start`/`end` compare `scheduled_out` in UTC. Date-only values
 * become 00:00:00Z; `end` is exclusive. A PEK 00:05 local departure on date
 * D is (D-1) 16:05Z, so `start=D-1` (00:00Z) drops the previous local day's
 * red-eye — the instance FlightAware's website is usually showing.
 *
 * Provider limits: start/end no further than 10 days back or 2 days ahead.
 */
export function aeroApiSearchWindow(
  selectedDate: string | undefined,
  now: Date = new Date(),
): { start: string; end: string } {
  const nowMs = now.getTime();
  const minStart = new Date(nowMs - 10 * MS_PER_DAY);
  const maxEnd = new Date(nowMs + 2 * MS_PER_DAY);

  let start: Date;
  let end: Date;
  if (selectedDate) {
    start = new Date(`${addUtcDays(selectedDate, -2)}T00:00:00Z`);
    end = new Date(`${addUtcDays(selectedDate, 2)}T00:00:00Z`);
  } else {
    start = new Date(nowMs - 2 * MS_PER_DAY);
    end = new Date(nowMs + 2 * MS_PER_DAY);
  }

  if (start < minStart) start = minStart;
  if (start > maxEnd) start = new Date(nowMs);
  if (end > maxEnd) end = maxEnd;
  if (end <= start) end = maxEnd;

  return { start: start.toISOString(), end: end.toISOString() };
}

function parseFlightInstant(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function flightTimeValue(flight: Record<string, unknown>, intent: FlightLookupIntent): string | undefined {
  if (intent === "arrive") {
    return (
      (flight.actual_in as string) ||
      (flight.estimated_in as string) ||
      (flight.scheduled_in as string) ||
      (flight.scheduled_on as string) ||
      undefined
    );
  }
  return (
    (flight.actual_out as string) ||
    (flight.estimated_out as string) ||
    (flight.scheduled_out as string) ||
    (flight.scheduled_off as string) ||
    undefined
  );
}

function flightLocalDate(flight: Record<string, unknown>, intent: FlightLookupIntent): string | undefined {
  const value = flightTimeValue(flight, intent);
  if (!value) return undefined;
  const airport =
    (intent === "arrive" ? flight.destination : flight.origin) as Record<string, unknown> | undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: (typeof airport?.timezone === "string" && airport.timezone) || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const dict = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${dict.year}-${dict.month}-${dict.day}`;
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function pickBestFlightAwareFlight(
  flights: Record<string, unknown>[],
  options: { date?: string; intent?: FlightLookupIntent; now?: number } = {},
): Record<string, unknown> | null {
  const intent = options.intent || "depart";
  const selectedDate = normalizeFlightDate(options.date);
  const candidates = selectedDate
    ? flights.filter((flight) => flightLocalDate(flight, intent) === selectedDate)
    : flights;
  if (!candidates.length) return null;
  const now = options.now ?? Date.now();

  const score = (flight: Record<string, unknown>): [number, number] => {
    const status = String(flight.status || "").toLowerCase();
    const cancelled = !!flight.cancelled || status.includes("cancel");
    const diverted = !!flight.diverted;
    let bucket = 1;
    if (cancelled) bucket = 3;
    else if (/en route|depart|taxi|airborne|boarding/.test(status)) bucket = 0;
    else if (/arriv|land/.test(status)) bucket = 2;
    if (diverted) bucket = Math.max(bucket, 2);
    const instant = parseFlightInstant(flightTimeValue(flight, intent));
    return [bucket, instant == null ? Number.MAX_SAFE_INTEGER : Math.abs(instant - now)];
  };

  return candidates.reduce((best, flight) => {
    const a = score(flight);
    const b = score(best);
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? flight : best;
  });
}

function isoOf(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function toLocal(iso: string | null | undefined, tz: unknown): string {
  if (!iso) return "—";
  try {
    return new Date(iso)
      .toLocaleString("en-CA", {
        timeZone: typeof tz === "string" && tz ? tz : "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function str(v: unknown, fallback = "—"): string {
  return typeof v === "string" && v ? v : fallback;
}

function iataOf(obj: Record<string, unknown>): string {
  const v = typeof obj.code_iata === "string" && obj.code_iata ? obj.code_iata : "";
  return v || str(obj.code, "");
}

function delayMinutes(value: unknown): number | null {
  return value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) / 60);
}

function mapFlightAwareFlight(
  f: Record<string, unknown>,
  flightIdent: string,
  intent: FlightLookupIntent,
): FlightResult {
  const origin = (f.origin as Record<string, unknown>) || {};
  const dest = (f.destination as Record<string, unknown>) || {};
  const depIata = iataOf(origin) || "—";
  const arrIata = iataOf(dest) || "—";
  const depIso = isoOf(f.scheduled_out) ?? isoOf(f.scheduled_off);
  const arrIso = isoOf(f.scheduled_in) ?? isoOf(f.scheduled_on);

  const durationMinutes =
    f.filed_ete != null
      ? Math.round(Number(f.filed_ete) / 60)
      : (() => {
          const out = parseFlightInstant(f.scheduled_out || f.scheduled_off);
          const incoming = parseFlightInstant(f.scheduled_in || f.scheduled_on);
          return out != null && incoming != null ? Math.round((incoming - out) / 60000) : null;
        })();

  const boardingTime = isoOf(f.boarding_start) ?? isoOf(f.scheduled_boarding);

  return {
    flight_iata:
      f.operator_iata && f.flight_number != null
        ? `${f.operator_iata}${f.flight_number}`
        : flightIdent,
    dep_iata: depIata,
    arr_iata: arrIata,
    dep_airport_code: str(origin.code, depIata),
    arr_airport_code: str(dest.code, arrIata),
    dep_time_local: toLocal(depIso, origin.timezone),
    arr_time_local: toLocal(arrIso, dest.timezone),
    dep_estimated_local: toLocal(isoOf(f.estimated_out) ?? isoOf(f.estimated_off), origin.timezone),
    arr_estimated_local: toLocal(isoOf(f.estimated_in) ?? isoOf(f.estimated_on), dest.timezone),
    dep_actual_local: toLocal(isoOf(f.actual_out) ?? isoOf(f.actual_off), origin.timezone),
    arr_actual_local: toLocal(isoOf(f.actual_in) ?? isoOf(f.actual_on), dest.timezone),
    dep_scheduled_iso: depIso,
    arr_scheduled_iso: arrIso,
    dep_terminal: str(f.terminal_origin),
    dep_gate: str(f.gate_origin),
    arr_terminal: str(f.terminal_destination),
    arr_gate: str(f.gate_destination),
    baggage_claim: str(f.baggage_claim),
    duration_minutes: Number.isFinite(durationMinutes as number) ? (durationMinutes as number) : null,
    departure_delay_minutes: delayMinutes(f.departure_delay),
    arrival_delay_minutes: delayMinutes(f.arrival_delay),
    fa_flight_id: str(f.fa_flight_id, ""),
    dep_airport_name: str(origin.name, ""),
    arr_airport_name: str(dest.name, ""),
    selected_date: flightLocalDate(f, intent),
    status: str(f.status, "Scheduled"),
    scheduled_out_utc: isoOf(f.scheduled_out),
    estimated_out_utc: isoOf(f.estimated_out),
    actual_out_utc: isoOf(f.actual_out),
    scheduled_off_utc: isoOf(f.scheduled_off),
    estimated_off_utc: isoOf(f.estimated_off),
    actual_off_utc: isoOf(f.actual_off),
    scheduled_on_utc: isoOf(f.scheduled_on),
    estimated_on_utc: isoOf(f.estimated_on),
    actual_on_utc: isoOf(f.actual_on),
    scheduled_in_utc: isoOf(f.scheduled_in),
    estimated_in_utc: isoOf(f.estimated_in),
    actual_in_utc: isoOf(f.actual_in),
    origin_timezone: typeof origin.timezone === "string" ? origin.timezone : null,
    destination_timezone: typeof dest.timezone === "string" ? dest.timezone : null,
    origin_country:
      str(origin.country_code, "") ||
      str(origin.country, "") ||
      AIRPORT_COUNTRIES[String(origin.code || depIata).toUpperCase()] ||
      AIRPORT_COUNTRIES[depIata.toUpperCase()] ||
      null,
    destination_country:
      str(dest.country_code, "") ||
      str(dest.country, "") ||
      AIRPORT_COUNTRIES[String(dest.code || arrIata).toUpperCase()] ||
      AIRPORT_COUNTRIES[arrIata.toUpperCase()] ||
      null,
    boarding_time_utc: boardingTime,
    boarding_time_source: boardingTime ? "api" : null,
  };
}

/** Card-shaped stub when AeroAPI has no row for this ident. */
export function unavailableFlightResult(flightIdent: string): FlightResult {
  const ident = normalizeFlight(flightIdent) || flightIdent;
  return {
    flight_iata: ident,
    dep_iata: "—",
    arr_iata: "—",
    dep_airport_code: "—",
    arr_airport_code: "—",
    dep_time_local: "—",
    arr_time_local: "—",
    dep_estimated_local: "—",
    arr_estimated_local: "—",
    dep_actual_local: "—",
    arr_actual_local: "—",
    dep_scheduled_iso: null,
    arr_scheduled_iso: null,
    dep_terminal: "—",
    dep_gate: "—",
    arr_terminal: "—",
    arr_gate: "—",
    baggage_claim: "—",
    duration_minutes: null,
    departure_delay_minutes: null,
    arrival_delay_minutes: null,
    fa_flight_id: "",
    dep_airport_name: "",
    arr_airport_name: "",
    selected_date: undefined,
    status: "Unavailable",
    scheduled_out_utc: null,
    estimated_out_utc: null,
    actual_out_utc: null,
    scheduled_off_utc: null,
    estimated_off_utc: null,
    actual_off_utc: null,
    scheduled_on_utc: null,
    estimated_on_utc: null,
    actual_on_utc: null,
    scheduled_in_utc: null,
    estimated_in_utc: null,
    actual_in_utc: null,
    origin_timezone: null,
    destination_timezone: null,
    origin_country: null,
    destination_country: null,
    boarding_time_utc: null,
    boarding_time_source: null,
  };
}

export async function fetchFlightAware(
  flightIdent: string,
  options: FetchFlightAwareOptions = {},
): Promise<FlightResult> {
  if (!FLIGHTAWARE_API_KEY) throw new Error("FLIGHTAWARE_API_KEY not configured");
  if (circuitIsOpen()) throw new Error("FlightAware circuit open: too many recent failures");
  return fetchFlightAwareUncached(flightIdent, options);
}

async function queryAeroApiFlights(
  ident: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>[]> {
  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}?${params}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-apikey": FLIGHTAWARE_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(FLIGHTAWARE_TIMEOUT_MS),
    });
  } catch (err) {
    recordFailure();
    throw err;
  }
  if (!res.ok) {
    recordFailure();
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }
  const j = (await res.json()) as Record<string, unknown>;
  return Array.isArray(j.flights) ? (j.flights as Record<string, unknown>[]) : [];
}

async function fetchFlightAwareUncached(
  flightIdent: string,
  options: FetchFlightAwareOptions = {},
): Promise<FlightResult> {
  const selectedDate = normalizeFlightDate(options.date);
  const intent: FlightLookupIntent = options.intent === "arrive" ? "arrive" : "depart";
  const window = aeroApiSearchWindow(selectedDate);
  const params = new URLSearchParams({
    start: window.start,
    end: window.end,
    max_pages: "1",
    ident_type: "designator",
  });

  const candidates = aeroApiIdentCandidates(normalizeFlight(flightIdent) || flightIdent);
  let flights: Record<string, unknown>[] = [];
  let usedIdent = candidates[0];
  for (const ident of candidates) {
    const page = await queryAeroApiFlights(ident, params);
    if (page.length > 0) {
      flights = page;
      usedIdent = ident;
      if (ident !== candidates[0]) {
        logger.info("flightaware_ident_fallback", { requested: flightIdent, used: ident });
      }
      break;
    }
  }
  if (flights.length === 0) {
    recordSuccess();
    logger.warn("flightaware_empty", {
      flightIdent,
      candidates,
      start: window.start,
      end: window.end,
      date: selectedDate,
    });
    throw new Error(`No flights found for ${flightIdent}`);
  }
  if (usedIdent !== flightIdent) {
    logger.info("flightaware_ident_resolved", { requested: flightIdent, used: usedIdent });
  }

  const dated = pickBestFlightAwareFlight(flights, { date: selectedDate, intent });
  const f = dated ?? (selectedDate ? pickBestFlightAwareFlight(flights, { intent }) : null);
  if (!f) {
    recordSuccess();
    throw new Error(`No flights found for ${flightIdent}${selectedDate ? ` on ${selectedDate}` : ""}`);
  }
  if (selectedDate && !dated) {
    logger.warn("flightaware_date_fallback", {
      flightIdent,
      requestedDate: selectedDate,
      usedDate: flightLocalDate(f, intent),
    });
  }

  recordSuccess();
  return mapFlightAwareFlight(f, flightIdent, intent);
}

/** One row on an airport departures/arrivals board. */
export type AirportBoardFlight = {
  flight: string;
  origin: string;
  destination: string;
  scheduledTime: string;
  status: string;
  gate: string;
};

export type AirportBoardKind = "departures" | "arrivals";

const BOARD_TIMEOUT_MS = 10_000;

function strField(v: unknown, fallback = ""): string {
  return typeof v === "string" && v ? v : fallback;
}

function localClock(iso: string | null, tz: unknown): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: typeof tz === "string" && tz ? tz : "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso.slice(11, 16) || "—";
  }
}

function mapBoardFlight(raw: Record<string, unknown>, kind: AirportBoardKind): AirportBoardFlight {
  const origin = (raw.origin as Record<string, unknown>) || {};
  const dest = (raw.destination as Record<string, unknown>) || {};
  const flight =
    (typeof raw.operator_iata === "string" && raw.flight_number != null
      ? `${raw.operator_iata}${raw.flight_number}`
      : "") ||
    strField(raw.ident_iata) ||
    strField(raw.ident) ||
    "—";

  const depIso =
    strField(raw.scheduled_out) || strField(raw.estimated_out) || strField(raw.scheduled_off) || null;
  const arrIso =
    strField(raw.scheduled_in) || strField(raw.estimated_in) || strField(raw.scheduled_on) || null;
  const scheduledIso = kind === "departures" ? depIso : arrIso;
  const tz = kind === "departures" ? origin.timezone : dest.timezone;
  const gate =
    kind === "departures"
      ? strField(raw.gate_origin) || strField(raw.terminal_origin)
      : strField(raw.gate_destination) || strField(raw.terminal_destination);

  return {
    flight,
    origin: iataOf(origin),
    destination: iataOf(dest),
    scheduledTime: localClock(scheduledIso, tz),
    status: strField(raw.status, "Scheduled"),
    gate: gate || "—",
  };
}

/**
 * Airport FIDS board via AeroAPI scheduled_departures / scheduled_arrivals.
 * `airportId` should be ICAO when possible (ZBAA); IATA (PEK) also works.
 */
export async function fetchAirportBoard(
  airportId: string,
  kind: AirportBoardKind,
): Promise<AirportBoardFlight[]> {
  if (!FLIGHTAWARE_API_KEY) throw new Error("FLIGHTAWARE_API_KEY not configured");
  if (circuitIsOpen()) throw new Error("FlightAware circuit open: too many recent failures");

  const path = kind === "departures" ? "scheduled_departures" : "scheduled_arrivals";
  const params = new URLSearchParams({ max_pages: "1", type: "Airline" });
  const url = `https://aeroapi.flightaware.com/aeroapi/airports/${encodeURIComponent(airportId)}/flights/${path}?${params}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-apikey": FLIGHTAWARE_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
    });
  } catch (err) {
    recordFailure();
    throw err;
  }
  if (!res.ok) {
    recordFailure();
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }

  const j = (await res.json()) as Record<string, unknown>;
  const key = kind === "departures" ? "scheduled_departures" : "scheduled_arrivals";
  const list = Array.isArray(j[key]) ? (j[key] as Record<string, unknown>[]) : [];
  recordSuccess();
  return list.map((f) => mapBoardFlight(f, kind));
}
