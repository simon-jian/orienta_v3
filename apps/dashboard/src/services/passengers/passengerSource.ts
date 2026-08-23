/**
 * PassengerSource — where the dashboard's passenger list comes from
 * (Multi-airport Phase 3).
 *
 * Today the only source is the live passenger registry REST API. Isolating it
 * here keeps `useDashboard` free of fetch/parse details and leaves room for an
 * airport that ships a static demo roster instead.
 */
import { apiUrl } from "../../config/api";
import type { Passenger } from "../../types/types";

/**
 * Fetch the passenger roster for a tenant.
 * Returns `null` on network/parse failure so callers can keep prior state
 * instead of clearing the list on a transient error.
 */
export async function fetchPassengers(tenantId: string): Promise<Passenger[] | null> {
  try {
    const r = await fetch(apiUrl(`/api/passengers?tenant=${encodeURIComponent(tenantId)}`), {
      credentials: "same-origin",
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.passengers)) return null;
    return j.passengers as Passenger[];
  } catch {
    return null;
  }
}

/** Distinct failure reasons so the board can explain what to do next. */
export type DeletePassengerResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "forbidden" | "request_failed" };

/**
 * Erase one passenger. The server cascades to chat history and push
 * subscriptions and revokes their sessions, so this is not reversible.
 * Admin-only server-side; `forbidden` is what an ops seat gets back.
 */
export async function deletePassenger(
  tenantId: string,
  passengerId: string,
): Promise<DeletePassengerResult> {
  try {
    const r = await fetch(
      apiUrl(`/api/passengers/${encodeURIComponent(passengerId)}?tenant=${encodeURIComponent(tenantId)}`),
      { method: "DELETE", credentials: "same-origin" },
    );
    if (r.ok) return { ok: true };
    if (r.status === 404) return { ok: false, error: "not_found" };
    if (r.status === 401 || r.status === 403) return { ok: false, error: "forbidden" };
    return { ok: false, error: "request_failed" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}
