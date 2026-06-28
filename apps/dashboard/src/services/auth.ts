/**
 * Client-side auth helpers.
 *
 * Authority is the httpOnly admin cookie. sessionStorage holds display fields only (no JWT).
 */
import type { AdminSession } from "../types/types";
import { apiUrl } from "../config/api";

const STORAGE_KEY = "orienta_session";

function cacheSession(session: AdminSession): AdminSession {
  const { exp, user } = session;
  const safe = { exp, user };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

/** Validate the httpOnly cookie with the server and return the session. */
export async function fetchSession(): Promise<AdminSession | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/me"), { credentials: "same-origin" });
    if (!res.ok) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const { session } = await res.json();
    if (!session?.user || !session?.exp) return null;
    return cacheSession(session as AdminSession);
  } catch {
    return null;
  }
}

/** Clear local session cache and tell the server to clear the cookie. */
export async function logout(): Promise<void> {
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "same-origin" });
  } catch {}
}

export { cacheSession };
