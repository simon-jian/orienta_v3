/**
 * PoiService — unified, airport-aware POI/gate access (Multi-airport Phase 3).
 *
 * Single entry point for "give me this airport's gates / center". It dispatches
 * on the registry's `poi.mode`:
 *   - "indoor_api" → the live PEK T3E adapter (`pekPoiCoords.ts`)
 *   - "static"     → the airport's `staticGates` table
 *   - "none"       → empty
 *
 * Consumers (Dashboard, MapView, PaxAppPage) call this directly and no longer
 * import the PEK adapter, so adding a hub is a registry entry + (if needed)
 * an adapter, never new branches in feature code.
 */
import type { Gate, LatLng } from "../../types/types";
import type { AirportDefinition } from "../../config/airports/types";
import { clientDefaultAirport } from "../../config/client";
import { getAirportOrDefault } from "../../config/airports/registry";
import { normalizePekGate } from "../../lib/pekPoiParse";
import {
  preloadPekPoiFromMapApi,
  getPekGateCoords,
  getPekGateCoord,
  getT3ESpineCenter,
} from "../pekPoiCoords";

function resolve(airportId?: string): AirportDefinition {
  return airportId ? getAirportOrDefault(airportId) : clientDefaultAirport();
}

/** Warm any remote POI source for the airport. No-op for static/none modes. */
export async function preloadPoi(airportId?: string): Promise<void> {
  const airport = resolve(airportId);
  if (airport.poi.mode === "indoor_api" && airport.poi.parser === "pek_t3e") {
    await preloadPekPoiFromMapApi();
  }
}

export function getGateCoords(airportId?: string): Record<string, LatLng> {
  const airport = resolve(airportId);
  if (airport.poi.mode === "indoor_api") return getPekGateCoords();
  if (airport.poi.mode === "static") return { ...(airport.poi.staticGates ?? {}) };
  return {};
}

export function getGateCoord(gateName: string, airportId?: string): LatLng | null {
  const airport = resolve(airportId);
  if (airport.poi.mode === "indoor_api") return getPekGateCoord(gateName);
  if (airport.poi.mode === "static") return airport.poi.staticGates?.[normalizePekGate(gateName)] ?? null;
  return null;
}

/** Fallback map center for the airport (live centroid for PEK, else config). */
export function getCenter(airportId?: string): LatLng {
  const airport = resolve(airportId);
  if (airport.poi.mode === "indoor_api") return getT3ESpineCenter();
  return { ...airport.poi.defaultCenter };
}

export function buildGatesFromCoords(coords: Record<string, LatLng>): Gate[] {
  return Object.entries(coords).map(([id, coordinate]) => ({ id, name: id, coordinate }));
}

export async function loadGates(airportId?: string): Promise<{ gates: Gate[]; source: string }> {
  await preloadPoi(airportId);
  const gates = buildGatesFromCoords(getGateCoords(airportId));
  return { gates, source: resolve(airportId).poi.parser };
}
