import type { Flight } from "../types/types";
import { getAirportOrDefault } from "../config/airports/registry";

/**
 * Build the dashboard flight list from an airport's demo/seed outbound flights
 * (Multi-airport: sourced from the registry instead of importing PEK directly).
 * Live deployments override these via FIDS; this is the offline fallback board.
 */
export function buildFlights(airportId?: string): Flight[] {
  const outbound = getAirportOrDefault(airportId).demo?.outboundFlights ?? [];
  return outbound.map((f) => ({
    id: f.id,
    callsign: f.id,
    destination: f.toCity,
    scheduledDep: new Date(Date.now() + f.depOffset * 60_000).toISOString(),
    status: f.status,
    gateId: f.gate,
    gateRef: f.gate,
  }));
}

/** @deprecated Use `buildFlights(airportId)`. Retained for back-compat (PEK). */
export function buildPekFlights(): Flight[] {
  return buildFlights("PEK");
}
