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
  // Any valid signed session may send chat:
  // free → AI agent reply; premium (operator_chat) → human operator path.
  // Without claims, privileged chat is denied.
  return !!claims;
}
