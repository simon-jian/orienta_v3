import { apiUrl } from "../../config/api";

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
};

export type PaxSessionApiResult = {
  ok: boolean;
  session?: PaxSession;
  error?: string;
};

const STORAGE_KEY = "orienta_pax_session";

export function savePaxSession(session: PaxSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getStoredPaxSession(): PaxSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PaxSession) : null;
  } catch {
    return null;
  }
}

export function clearPaxSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function fetchPaxSession(token: string): Promise<PaxSession> {
  const res = await fetch(apiUrl("/api/pax/session"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as PaxSessionApiResult;
  if (!res.ok || !data.ok || !data.session) {
    throw new Error(data.error || "session_invalid");
  }
  savePaxSession(data.session);
  return data.session;
}
