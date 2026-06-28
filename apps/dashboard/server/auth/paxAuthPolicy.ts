/**
 * Passenger auth policy — session JWT vs legacy demo pages.
 *
 * Entitlement order (P0-4):
 *   1. Session JWT present  → decide purely from `claims.capabilities` (production path).
 *   2. No JWT + PAX_LEGACY_AUTH=0 → deny (no static premium-id fallback).
 *   3. No JWT + PAX_LEGACY_AUTH=1 → legacy demo fallback via PEK_PREMIUM_IDS.
 *
 * `PEK_PREMIUM_IDS` is therefore DEPRECATED for production and is only reachable
 * in legacy mode. When PAX_LEGACY_AUTH=0 it is never consulted.
 */
import { HubStore } from "../hub/HubStore";
import type { PaxSessionClaims } from "../passengers/paxSessionToken";
import { PAX_LEGACY_AUTH } from "../config";
import { PEK_PREMIUM_IDS } from "../../src/data/airports/pek";

/**
 * @deprecated Legacy-only. Operator-chat entitlement in production comes from
 * session `capabilities`. Reachable solely when PAX_LEGACY_AUTH=1.
 */
export function legacyPlanForPassenger(passengerId: string): "premium" | "free" {
  return PEK_PREMIUM_IDS.has(passengerId) ? "premium" : "free";
}

export function paxCanSendChat(
  claims: PaxSessionClaims | null,
  store: HubStore,
  tenantId: string,
  passengerId: string,
  kind: string,
): boolean {
  if (kind === "location") return true;
  // Production: capabilities from the signed session are the single source of truth.
  if (claims) return claims.capabilities?.includes("operator_chat") ?? false;
  // No session: only legacy mode may fall back to demo premium IDs.
  if (!PAX_LEGACY_AUTH) return false;
  const plan = store.paxMeta.get(HubStore.key(tenantId, passengerId))?.plan
    ?? legacyPlanForPassenger(passengerId);
  return plan === "premium";
}
