/**
 * Passenger auth policy — session JWT vs legacy demo pages.
 */
import { HubStore } from "../hub/HubStore";
import type { PaxSessionClaims } from "../passengers/paxSessionToken";
import { PAX_LEGACY_AUTH } from "../config";
import { PEK_PREMIUM_IDS } from "../../src/data/airports/pek";
import { SFO_PREMIUM_IDS } from "../../src/data/airports/sfo";

/** Legacy demo passengers with operator chat (data-driven, not client msg.plan). */
export function legacyPlanForPassenger(passengerId: string): "premium" | "free" {
  return PEK_PREMIUM_IDS.has(passengerId) || SFO_PREMIUM_IDS.has(passengerId) ? "premium" : "free";
}

export function paxCanSendChat(
  claims: PaxSessionClaims | null,
  store: HubStore,
  tenantId: string,
  passengerId: string,
  kind: string,
): boolean {
  if (kind === "location") return true;
  if (claims) return claims.capabilities?.includes("operator_chat") ?? false;
  if (!PAX_LEGACY_AUTH) return false;
  const plan = store.paxMeta.get(HubStore.key(tenantId, passengerId))?.plan
    ?? legacyPlanForPassenger(passengerId);
  return plan === "premium";
}
