import type { Flight } from "../types/types";
import { PEK_OUTBOUND_FLIGHTS } from "../data/airports/pek";

export function buildPekFlights(): Flight[] {
  return PEK_OUTBOUND_FLIGHTS.map((f) => ({
    id: f.id,
    callsign: f.id,
    destination: f.toCity,
    scheduledDep: new Date(Date.now() + f.depOffset * 60_000).toISOString(),
    status: f.status,
    gateId: f.gate,
    gateRef: f.gate,
  }));
}
