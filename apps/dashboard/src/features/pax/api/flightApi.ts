import { apiUrl } from "../../../config/api";

export type FlightInstance = {
  flight_iata: string;
  dep_iata: string;
  arr_iata: string;
  dep_airport_code?: string;
  arr_airport_code?: string;
  dep_time_local: string;
  arr_time_local: string;
  dep_estimated_local?: string;
  arr_estimated_local?: string;
  dep_actual_local?: string;
  arr_actual_local?: string;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  baggage_claim?: string;
  duration_minutes?: number | null;
  departure_delay_minutes?: number | null;
  arrival_delay_minutes?: number | null;
  fa_flight_id?: string;
  dep_airport_name?: string;
  arr_airport_name?: string;
  selected_date?: string;
  dep_scheduled_iso?: string | null;
  arr_scheduled_iso?: string | null;
  scheduled_out_utc?: string | null;
  estimated_out_utc?: string | null;
  actual_out_utc?: string | null;
  scheduled_in_utc?: string | null;
  estimated_in_utc?: string | null;
  actual_in_utc?: string | null;
  origin_timezone?: string | null;
  destination_timezone?: string | null;
  boarding_time_utc?: string | null;
  boarding_time_source?: string | null;
  status?: string;
};

export type ClosestFlightResult = {
  instance: FlightInstance;
  badge: { label: string; class: string };
  provider?: string;
};

export type TransferResult = {
  arrival: FlightInstance;
  departure: FlightInstance;
  hub_airport: string;
  from_gate: string;
  to_gate: string;
  walk_distance_m?: number | null;
  walk_time_min?: number | null;
  provider?: string;
};

async function readOkData<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.ok || !data.data) {
    throw new Error(data.message || data.error || `request_failed_${res.status}`);
  }
  return data.data;
}

export async function fetchClosestFlight(flight: string, date?: string, intent?: string) {
  const params = new URLSearchParams({ q: flight });
  if (date) params.set("date", date);
  if (intent) params.set("intent", intent);
  const res = await fetch(apiUrl(`/api/flight/closest?${params}`));
  return readOkData<ClosestFlightResult>(res);
}

export async function fetchTransfer(arrivalFlight: string, departureFlight: string) {
  const res = await fetch(apiUrl("/api/transfer"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arrFlight: arrivalFlight, depFlight: departureFlight }),
  });
  return readOkData<TransferResult>(res);
}
