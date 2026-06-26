/**
 * Shared admin JWT + cookie helpers for HTTP routes and the WebSocket hub.
 */
import { jwtVerify, type JWTPayload } from "jose";
import { JWT_SECRET } from "../config";

export const ADMIN_COOKIE_NAME = "orienta_admin_token";
export const ADMIN_JWT_TTL_S = 60 * 60 * 8;

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function adminTokenFromCookieHeader(header: string | undefined): string {
  return parseCookieHeader(header)[ADMIN_COOKIE_NAME] || "";
}

export async function verifyAdminToken(token: string): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function adminPayloadFromCookieHeader(header: string | undefined): Promise<JWTPayload | null> {
  return verifyAdminToken(adminTokenFromCookieHeader(header));
}
