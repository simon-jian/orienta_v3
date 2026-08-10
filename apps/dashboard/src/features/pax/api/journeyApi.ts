import { apiUrl } from "../../../config/api";

async function paxFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || data.error || `request_failed_${res.status}`);
  }
  return data.data as T;
}

export type JourneyPreferences = {
  checkedBags: "yes" | "no" | "unknown";
  securityLane: string;
  seatZone: string;
  destination: string;
  immigration: string;
  boardingBuffer: number;
};

/** Local calendar date (YYYY-MM-DD) — do not use UTC toISOString slicing. */
export function flightDateToday(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getJourneyPreferences(token: string, flight: string, date: string) {
  return paxFetch<{ preferences: JourneyPreferences }>(
    token,
    `/api/flights/${encodeURIComponent(flight)}/journey-preferences?date=${encodeURIComponent(date)}`,
  );
}

export function patchJourneyPreferences(
  token: string,
  flight: string,
  date: string,
  patch: Partial<JourneyPreferences>,
) {
  return paxFetch<{ preferences: JourneyPreferences }>(
    token,
    `/api/flights/${encodeURIComponent(flight)}/journey-preferences?date=${encodeURIComponent(date)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function getTimeToGate(token: string, flight: string, date: string) {
  return paxFetch<Record<string, unknown>>(
    token,
    `/api/flights/${encodeURIComponent(flight)}/time-to-gate?date=${encodeURIComponent(date)}`,
  );
}

export function getTimeToExit(token: string, flight: string, date: string) {
  return paxFetch<Record<string, unknown>>(
    token,
    `/api/flights/${encodeURIComponent(flight)}/time-to-exit?date=${encodeURIComponent(date)}`,
  );
}

export function postJourneyEvent(
  token: string,
  flight: string,
  date: string,
  event: "off-plane" | "bags-collected" | "outside",
) {
  return paxFetch(
    token,
    `/api/flights/${encodeURIComponent(flight)}/journey-events?date=${encodeURIComponent(date)}`,
    {
      method: "POST",
      body: JSON.stringify({ event, occurredAt: new Date().toISOString() }),
    },
  );
}

export function createArrivalShare(
  token: string,
  flight: string,
  date: string,
  body: Record<string, unknown> = {},
) {
  return paxFetch<{
    shareId: string;
    url: string;
    managementToken?: string;
    expiresAt: string;
    reused: boolean;
  }>(
    token,
    `/api/flights/${encodeURIComponent(flight)}/arrival-share?date=${encodeURIComponent(date)}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function fetchPublicArrival(shareId: string, publicToken: string) {
  const res = await fetch(
    apiUrl(
      `/api/arrival/${encodeURIComponent(shareId)}?token=${encodeURIComponent(publicToken)}`,
    ),
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: Record<string, unknown>;
    message?: string;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.data) {
    throw new Error(data.message || data.error || "arrival_load_failed");
  }
  return data.data;
}
