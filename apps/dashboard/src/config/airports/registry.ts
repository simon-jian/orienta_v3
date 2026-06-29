/**
 * Airport registry — lookup by id / IATA / ICAO.
 *
 * The registry is hydrated at runtime from data config: the server loads YAML
 * from `config/airports/*.yaml` at startup; the browser loads the same data from
 * the `/api/config/bootstrap` endpoint before render. No airport is hardcoded
 * here, and no consumer should branch on a literal airport code — resolve
 * through `getAirport()` / `getAirportOrDefault()` instead.
 */
import type { AirportDefinition, AirportId } from "./types";

const registry = new Map<string, AirportDefinition>();
let defaultId = "PEK";

/**
 * Minimal built-in fallback so the UI still renders if config failed to load
 * (e.g. the bootstrap fetch failed). It carries no real hub data.
 */
const FALLBACK_AIRPORT: AirportDefinition = {
  id: "PEK",
  iata: "PEK",
  name: "Default Hub",
  terminals: [],
  defaultTerminal: "",
  poi: { mode: "none", parser: "generic", defaultCenter: { lat: 0, lng: 0 } },
  map: { indoorMapEnabled: false },
};

/** Register a single airport under its id, IATA, and ICAO (case-insensitive). */
export function registerAirport(def: AirportDefinition): void {
  registry.set(def.id.trim().toUpperCase(), def);
  if (def.iata) registry.set(def.iata.trim().toUpperCase(), def);
  if (def.icao) registry.set(def.icao.trim().toUpperCase(), def);
}

/** Replace all registered airports (server startup / client bootstrap). */
export function setAirports(defs: AirportDefinition[], opts?: { defaultId?: string }): void {
  registry.clear();
  for (const d of defs) registerAirport(d);
  if (opts?.defaultId) defaultId = opts.defaultId.trim().toUpperCase();
  else if (defs[0]) defaultId = defs[0].id.trim().toUpperCase();
}

export function setDefaultAirportId(id: string): void {
  if (id && id.trim()) defaultId = id.trim().toUpperCase();
}

/** Current default hub id (set during hydration). */
export function defaultAirportId(): AirportId {
  return defaultId;
}

/** Resolve an airport by id / IATA / ICAO. Returns undefined if unknown. */
export function getAirport(id: string | null | undefined): AirportDefinition | undefined {
  if (!id) return undefined;
  return registry.get(id.trim().toUpperCase());
}

/** Resolve an airport, falling back to the default hub (then any / a stub). */
export function getAirportOrDefault(id?: string | null): AirportDefinition {
  return getAirport(id) ?? registry.get(defaultId) ?? listAirports()[0] ?? FALLBACK_AIRPORT;
}

/** All registered airports (deduplicated; same def keyed under id/IATA/ICAO). */
export function listAirports(): AirportDefinition[] {
  return [...new Set(registry.values())];
}
