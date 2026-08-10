import { apiUrl } from "../../../config/api";
import {
  savePaxSession,
  savePaxTrip,
  type PaxSession,
  type PaxSessionApiResult,
  type PaxTripContext,
} from "../session";

async function postSession(path: string, body: Record<string, unknown>): Promise<PaxSession> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as PaxSessionApiResult;
  if (!res.ok || !data.ok || !data.session) {
    throw new Error(data.error || "session_failed");
  }
  if (data.trip) {
    savePaxTrip(data.trip);
    data.session.trip = data.trip;
  }
  savePaxSession(data.session);
  return data.session;
}

export function mintBoardingPassSession(bcbp: string, extras: Record<string, unknown> = {}) {
  return postSession("/api/pax/boarding-pass", { bcbp, ...extras });
}

export function mintBasicSession(input: {
  intent: PaxTripContext["intent"];
  flight?: string;
  date?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  arrivalDate?: string;
  departureDate?: string;
  name?: string;
}) {
  return postSession("/api/pax/basic-session", input);
}

export async function mintAccountSession(input: {
  email: string;
  password: string;
  departureFlight: string;
  arrivalFlight?: string;
  name?: string;
}) {
  const session = await postSession("/api/pax/account-login", input);
  const trip = {
    intent: "depart" as const,
    flight: input.departureFlight,
    departureFlight: input.departureFlight,
    date: undefined as string | undefined,
  };
  savePaxTrip(trip);
  session.trip = trip;
  savePaxSession(session);
  return session;
}
