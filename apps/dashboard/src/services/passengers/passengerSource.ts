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
    const r = await fetch(apiUrl(`/api/passengers?tenant=${encodeURIComponent(tenantId)}`));
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.passengers)) return null;
    return j.passengers as Passenger[];
  } catch {
    return null;
  }
}
