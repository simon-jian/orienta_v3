/**
 * Shared admin JWT + cookie helpers for HTTP routes and the WebSocket hub.
 *
 * Security note: admin tokens use a dedicated issuer/audience (`ADMIN_TOKEN_AUDIENCE`)
 * that is distinct from the passenger session audience (`PAX_SESSION_AUDIENCE` in
 * paxSessionToken.ts). Both token kinds are signed with the same JWT_SECRET, so
 * without this separation a passenger could self-issue a session (via the public
 * POST /api/pax/basic-session) and replay it as an admin cookie — jose only
 * validates iss/aud when explicitly asked to, so `verifyAdminToken` MUST always
 * pass them. Do not remove the `issuer`/`audience` options below.
 */
import { jwtVerify, type JWTPayload } from "jose";
import { JWT_SECRET } from "../config";
import { isAdminTokenRevoked } from "./adminSessionRevocation";

export const ADMIN_COOKIE_NAME = "orienta_admin_token";
export const ADMIN_JWT_TTL_S = 60 * 60 * 8;
export const ADMIN_TOKEN_AUDIENCE = "orienta-admin";

/** Recognized admin roles. Shared with wsHub.ts so both auth gates agree. */
export const ADMIN_ROLES = new Set(["admin", "ops", "viewer"]);

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

/**
 * True when this admin's token is allowed to act on `tenantId` — either the
 * token carries no `tenants` restriction (legacy/default: every admin can act
 * on every tenant, matching pre-existing single-tenant deployments) or
 * `tenantId` is explicitly in its list. See config.ts ADMIN_TENANT_SCOPES.
 */
export function adminAllowedForTenant(payload: JWTPayload, tenantId: string): boolean {
  const tenants = payload.tenants;
  if (!Array.isArray(tenants) || tenants.length === 0) return true;
  return tenants.includes(tenantId);
}

/**
 * Verify an admin JWT: signature, expiry, issuer/audience, and that the payload
 * carries a recognized role. Returns null for anything else (including a
 * well-formed but foreign token, e.g. a passenger session).
 */
export async function verifyAdminToken(token: string): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ADMIN_TOKEN_AUDIENCE,
      audience: ADMIN_TOKEN_AUDIENCE,
    });
    if (!ADMIN_ROLES.has(String(payload.role))) return null;
    // Checked after signature verification (cheap for the common case: no
    // jti recorded as revoked) so a logged-out token stops working
    // immediately instead of staying valid until its natural expiry.
    if (await isAdminTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function adminPayloadFromCookieHeader(header: string | undefined): Promise<JWTPayload | null> {
  return verifyAdminToken(adminTokenFromCookieHeader(header));
}
