/**
 * Flight context for Time-to-Gate / Time-to-Exit. Maps AeroAPI (via the shared
 * FlightAware client) into the shape the passenger time engine expects.
 */
import {
  fetchFlightAware,
  normalizeFlight,
  type FlightLookupIntent,
  type FlightResult,
} from "../services/flightAware";
import { AircraftClass } from "../services/passengerTimeEngine";

export type JourneyFlightIntent = "depart" | "arrive";

export type JourneyFlightInstance = {
  flight_iata: string;
  dep_iata: string;
  arr_iata: string;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  status: string;
  scheduled_out_utc: string | null;
  estimated_out_utc: string | null;
  actual_out_utc: string | null;
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
  aircraft_class: AircraftClass | null;
  boarding_time_utc: string | null;
  selected_date: string | null;
};

const KNOWN_AIRPORT_COUNTRY: Record<string, string> = {
  PEK: "CN",
  PKX: "CN",
  PVG: "CN",
  SHA: "CN",
  CAN: "CN",
  SFO: "US",
  BOS: "US",
  JFK: "US",
  LAX: "US",
  ORD: "US",
};

function countryForAirport(iata: string): string | null {
  return KNOWN_AIRPORT_COUNTRY[iata.toUpperCase()] || null;
}

function dashToNull(value: string | null | undefined): string {
  if (!value || value === "—") return "";
  return value;
}

export function journeyInstanceFromFlightResult(
  result: FlightResult,
  preferredDate?: string,
): JourneyFlightInstance {
  return {
    flight_iata: result.flight_iata,
    dep_iata: result.dep_iata,
    arr_iata: result.arr_iata,
    dep_terminal: dashToNull(result.dep_terminal),
    dep_gate: dashToNull(result.dep_gate),
    arr_terminal: dashToNull(result.arr_terminal),
    arr_gate: dashToNull(result.arr_gate),
    status: result.status,
    scheduled_out_utc: result.scheduled_out_utc ?? result.dep_scheduled_iso,
    estimated_out_utc: result.estimated_out_utc,
    actual_out_utc: result.actual_out_utc,
    scheduled_on_utc: result.scheduled_on_utc,
    estimated_on_utc: result.estimated_on_utc,
    actual_on_utc: result.actual_on_utc,
    scheduled_in_utc: result.scheduled_in_utc ?? result.arr_scheduled_iso,
    estimated_in_utc: result.estimated_in_utc,
    actual_in_utc: result.actual_in_utc,
    origin_timezone: result.origin_timezone,
    destination_timezone: result.destination_timezone,
    origin_country: result.origin_country || countryForAirport(result.dep_iata),
    destination_country: result.destination_country || countryForAirport(result.arr_iata),
    aircraft_class: AircraftClass.Unknown,
    boarding_time_utc: result.boarding_time_utc,
    selected_date: preferredDate || result.selected_date || null,
  };
}

export async function fetchJourneyFlight(
  flightIdent: string,
  options: { date?: string; intent?: JourneyFlightIntent } = {},
): Promise<JourneyFlightInstance> {
  const ident = normalizeFlight(flightIdent);
  if (!ident) throw new Error("invalid_flight_ident");
  const intent: FlightLookupIntent = options.intent === "arrive" ? "arrive" : "depart";
  const result = await fetchFlightAware(ident, { date: options.date, intent });
  return journeyInstanceFromFlightResult(result, options.date);
}
