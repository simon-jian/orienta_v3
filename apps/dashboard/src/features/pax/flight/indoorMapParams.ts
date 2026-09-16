export type IndoorMapLeg = "dep" | "arr";

export function usableMapGate(value: string | undefined | null): string {
  const g = (value || "").trim();
  if (!g || g === "—" || g === "-") return "";
  return g;
}

export function usableMapAirport(value: string | undefined | null): string {
  const c = String(value || "")
    .trim()
    .toUpperCase();
  if (!c || c === "—" || c === "-") return "";
  return c;
}

/** Departure / arrival map airports follow the open flight, not the transfer hub. */
export function flightMapAirports(instance: {
  dep_iata?: string;
  arr_iata?: string;
  dep_airport_code?: string;
  arr_airport_code?: string;
}): { dep: string; arr: string } {
  return {
    dep: usableMapAirport(instance.dep_iata) || usableMapAirport(instance.dep_airport_code),
    arr: usableMapAirport(instance.arr_iata) || usableMapAirport(instance.arr_airport_code),
  };
}

/** PEK departures live on T3E L2; arrivals on L3. */
export function indoorMapFloor(airport: string, leg: IndoorMapLeg): "L2" | "L3" | undefined {
  if (airport !== "PEK") return undefined;
  return leg === "dep" ? "L2" : "L3";
}

/**
 * The map has both "E12 登机口" (L2) and "E12 到达口" (L3). A bare "E12"
 * matches the departure stand and draws the Y-pier on an arrival tab.
 */
export function indoorMapGateLabel(airport: string, gate: string, leg: IndoorMapLeg): string {
  const g = usableMapGate(gate);
  if (!g || airport !== "PEK") return g;
  if (/到达|登机|安检/.test(g)) return g;
  return leg === "arr" ? `${g} 到达口` : `${g} 登机口`;
}
