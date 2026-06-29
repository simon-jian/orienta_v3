/**
 * Dashboard FIDS board (departures / arrivals).
 *
 * Sourced from the airport registry's demo/seed flights (no hardcoded PEK board);
 * times are derived from each flight's offset so the board stays plausible. Live
 * deployments would back this with a real FIDS feed instead.
 */
import { getAirportOrDefault } from "../config/airports/registry";

export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

export const REFRESH_MS = 60 * 60 * 1000; // 1 hour

/** Offset (minutes from now) → "3:28pm" style clock label. */
function clockFromOffset(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60_000);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

function departureStatus(s: string): string {
  return s === "Closed" ? "Departed" : s;
}

export async function fetchDepartures(airport?: string): Promise<FidsFlight[]> {
  const def = getAirportOrDefault(airport);
  const outbound = def.demo?.outboundFlights ?? [];
  return outbound.map((f) => ({
    flight: f.id,
    destination: f.toCity,
    scheduledTime: clockFromOffset(f.depOffset),
    status: departureStatus(f.status),
    gate: f.gate,
  }));
}

export async function fetchArrivals(airport?: string): Promise<FidsFlight[]> {
  const def = getAirportOrDefault(airport);
  const inbound = def.demo?.inboundFlights ?? [];
  const gateMap = def.demo?.flightGateMap ?? {};
  return inbound.map((f) => ({
    flight: f.id,
    origin: f.fromCity,
    scheduledTime: clockFromOffset(f.arr),
    status: f.arr <= 0 ? "Landed" : "On Time",
    gate: gateMap[f.id],
  }));
}
