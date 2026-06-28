/**
 * Gate service — thin compatibility shim over the airport-aware PoiService.
 *
 * @deprecated Prefer `PoiService.loadGates(airportId)` directly. Retained so the
 * dashboard's existing call site keeps working (Multi-airport Phase 3).
 */
import type { Gate } from "../types/types";
import { loadGates as poiLoadGates, buildGatesFromCoords } from "./poi/PoiService";

export { buildGatesFromCoords };

export async function loadGates(
  airportId?: string,
): Promise<{ gates: Gate[]; source: "t3e_hardcoded" | "overpass" | "synthetic" }> {
  const { gates } = await poiLoadGates(airportId);
  return { gates, source: "t3e_hardcoded" };
}
