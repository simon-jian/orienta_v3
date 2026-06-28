/**
 * Airport registry — lookup by id / IATA / ICAO (Multi-airport Phase 0).
 *
 * Adding a hub = `register(myAirport)` + a tenant mapping. No consumer should
 * branch on a hardcoded airport code; resolve through `getAirport()` instead.
 */
import type { AirportDefinition, AirportId } from "./types";
import { PEK_AIRPORT } from "./pek.config";

const registry = new Map<string, AirportDefinition>();

/** Register an airport under its id, IATA, and ICAO (all case-insensitive). */
export function register(def: AirportDefinition): void {
  registry.set(def.id.trim().toUpperCase(), def);
  if (def.iata) registry.set(def.iata.trim().toUpperCase(), def);
  if (def.icao) registry.set(def.icao.trim().toUpperCase(), def);
}

register(PEK_AIRPORT);

/** Fallback hub when none is specified (PEK while it is the only entry). */
export const DEFAULT_AIRPORT_ID: AirportId = PEK_AIRPORT.id;

/** Resolve an airport by id / IATA / ICAO. Returns undefined if unknown. */
export function getAirport(id: string | null | undefined): AirportDefinition | undefined {
  if (!id) return undefined;
  return registry.get(id.trim().toUpperCase());
}

/** Resolve an airport, falling back to the default hub. */
export function getAirportOrDefault(id?: string | null): AirportDefinition {
  return getAirport(id) ?? getAirport(DEFAULT_AIRPORT_ID)!;
}

/** All registered airports (deduplicated; the same def is keyed under id/IATA/ICAO). */
export function listAirports(): AirportDefinition[] {
  return [...new Set(registry.values())];
}
