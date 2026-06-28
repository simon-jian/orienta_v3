/**
 * Gate service — loads PEK T3E gates from POI API.
 * Updated to import from types/index and pekPoiCoords.
 */
import type { Gate, LatLng } from "../types/types";
import { preloadPekPoiFromMapApi, getPekGateCoords } from "./pekPoiCoords";

/** Build Gate[] from loaded POI coordinates. */
export function buildGatesFromCoords(coords: Record<string, LatLng>): Gate[] {
  return Object.entries(coords).map(([id, coordinate]) => ({
    id,
    name: id,
    coordinate,
  }));
}

export async function loadGates(): Promise<{ gates: Gate[]; source: "t3e_hardcoded" | "overpass" | "synthetic" }> {
  await preloadPekPoiFromMapApi();
  const coords = getPekGateCoords();
  const gates = buildGatesFromCoords(coords);
  return { gates, source: "t3e_hardcoded" };
}
