/**
 * Passenger auth policy — entitlement is derived purely from the signed
 * session JWT (`claims.capabilities`). Without a valid session, privileged
 * actions (operator chat) are denied.
 */
import type { PaxSessionClaims } from "../passengers/paxSessionToken";

export function paxCanSendChat(
  claims: PaxSessionClaims | null,
  kind: string,
): boolean {
  if (kind === "location") return true;
  // Capabilities from the signed session are the single source of truth.
  return claims ? (claims.capabilities?.includes("operator_chat") ?? false) : false;
}
