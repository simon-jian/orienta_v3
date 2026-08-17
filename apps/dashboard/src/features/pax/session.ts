import { apiUrl } from "../../config/api";

export type PaxTripIntent = "depart" | "arrive" | "transfer";

export type PaxTripContext = {
  intent: PaxTripIntent;
  flight?: string;
  date?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  arrivalDate?: string;
  departureDate?: string;
};

export type PaxSession = {
  token: string;
  passenger: {
    id: string;
    tenantId: string;
    name: string;
    plan: "premium" | "free";
    flightId: string;
    gateId: string;
  };
  accountType: "temporary" | "registered";
  plan: "premium" | "free";
  capabilities: string[];
  expiresAt: number;
  trip?: PaxTripContext;
};

export type PaxSessionApiResult = {
  ok: boolean;
  session?: PaxSession;
  trip?: PaxTripContext;
  error?: string;
};

const STORAGE_KEY = "orienta_pax_session";
const TRIP_KEY = "orienta_pax_trip";
const DEVICE_KEY = "orienta_device_id";

function randomId(): string {
  // randomUUID needs a secure context; getRandomValues is available more
  // widely, and the last resort only has to be unique, not unguessable — the
  // server treats the device id as an identifier, never as a credential.
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Stable per-browser id used to bind an invite link to one device.
 *
 * Kept in localStorage so it survives closing the tab — sessionStorage (where
 * the session itself lives) would make the passenger look like a new device on
 * every visit. When storage is unavailable (private mode, blocked cookies) the
 * id is generated per call: the current claim still succeeds, but the binding
 * cannot persist, and the passenger will need a support reset next time.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

export function localCalendarDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function savePaxSession(session: PaxSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  if (session.trip) {
    sessionStorage.setItem(TRIP_KEY, JSON.stringify(session.trip));
  }
}

export function savePaxTrip(trip: PaxTripContext): void {
  sessionStorage.setItem(TRIP_KEY, JSON.stringify(trip));
}

export function getStoredPaxTrip(): PaxTripContext | null {
  try {
    const raw = sessionStorage.getItem(TRIP_KEY);
    return raw ? (JSON.parse(raw) as PaxTripContext) : null;
  } catch {
    return null;
  }
}

export function getStoredPaxSession(): PaxSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as PaxSession;
    if (!session.trip) {
      const trip = getStoredPaxTrip();
      if (trip) session.trip = trip;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearPaxSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(TRIP_KEY);
}

export async function fetchPaxSession(token: string): Promise<PaxSession> {
  const res = await fetch(apiUrl("/api/pax/session"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as PaxSessionApiResult;
  if (!res.ok || !data.ok || !data.session) {
    throw new Error(data.error || "session_invalid");
  }
  const trip = getStoredPaxTrip() || data.session.trip;
  const session = trip ? { ...data.session, trip } : data.session;
  savePaxSession(session);
  return session;
}
