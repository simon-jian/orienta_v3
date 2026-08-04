import type { JWTPayload } from "jose";
import { isPaxSessionRevoked } from "../auth/paxSessionRevocation";
import { verifyWithRotatingSecret } from "../auth/jwtRotation";

export type PaxSessionClaims = JWTPayload & {
  tenantId: string;
  /** Hub the passenger belongs to (Multi-airport Phase 5). Optional for tokens issued before it was added. */
  airportId?: string;
  accountType: "temporary" | "registered";
  plan: "premium" | "free";
  capabilities: string[];
};

export const PAX_SESSION_AUDIENCE = "orienta-pax";

export function bearerTokenFromHeader(value: unknown): string {
  const header = String(value || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function verifyPaxSessionToken(token: string): Promise<PaxSessionClaims | null> {
  if (!token) return null;
  try {
    // Tries JWT_SECRET, then any JWT_SECRET_PREVIOUS values — see config.ts
    // JWT_SECRET_PREVIOUS / server/auth/adminAuth.ts's identical use.
    const payload = await verifyWithRotatingSecret(token, {
      issuer: PAX_SESSION_AUDIENCE,
      audience: PAX_SESSION_AUDIENCE,
    });
    if (!payload.sub || typeof payload.tenantId !== "string") return null;
    // Checked after signature verification (cheap for the common case: no
    // cutover recorded for this passenger). Catches a passenger whose plan
    // changed or who was deleted after this token was issued — plan/
    // capabilities are frozen into the token at issue time, so without this
    // an already-issued token keeps the old privileges until it naturally
    // expires (up to 30 days for a registered account).
    if (typeof payload.iat === "number" && (await isPaxSessionRevoked(payload.tenantId, payload.sub, payload.iat * 1000))) {
      return null;
    }
    return payload as PaxSessionClaims;
  } catch {
    return null;
  }
}
