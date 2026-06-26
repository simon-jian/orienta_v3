import { jwtVerify, type JWTPayload } from "jose";
import { JWT_SECRET } from "../config";

export type PaxSessionClaims = JWTPayload & {
  tenantId: string;
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
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: PAX_SESSION_AUDIENCE,
      audience: PAX_SESSION_AUDIENCE,
    });
    if (!payload.sub || typeof payload.tenantId !== "string") return null;
    return payload as PaxSessionClaims;
  } catch {
    return null;
  }
}
