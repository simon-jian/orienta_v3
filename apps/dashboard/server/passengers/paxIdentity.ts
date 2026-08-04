/**
 * Resolves passenger identity from HTTP headers and request fields.
 */
import { ROUTE_SITE_DEFAULT_TENANT } from "../config";
import {
  bearerTokenFromHeader,
  verifyPaxSessionToken,
  type PaxSessionClaims,
} from "./paxSessionToken";
import { canonicalTenantId } from "../lib/canonicalize";

export type PaxResolvedIdentity = {
  tenantId: string;
  passengerId: string;
  claims: PaxSessionClaims | null;
};

export type PaxIdentityFailure = {
  status: number;
  error: string;
};

type PaxIdentityInput = {
  authorizationHeader?: unknown;
  tenantId?: unknown;
  tenant_id?: unknown;
  passengerId?: unknown;
  passenger_id?: unknown;
};

function readTenantId(input: PaxIdentityInput): string {
  // Canonicalized so a body-supplied "AirChina" against a token's
  // already-canonical "airchina" claim doesn't fail the mismatch check
  // below purely over casing.
  return canonicalTenantId(input.tenantId || input.tenant_id) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
}

function readPassengerId(input: PaxIdentityInput): string {
  return String(input.passengerId || input.passenger_id || "").trim();
}

/**
 * Validates passenger identity for HTTP routes and WS hello frames.
 * A valid session JWT is required; requests without one are rejected.
 */
export async function resolvePaxIdentity(
  input: PaxIdentityInput,
): Promise<{ ok: true; identity: PaxResolvedIdentity } | { ok: false; failure: PaxIdentityFailure }> {
  const token = bearerTokenFromHeader(input.authorizationHeader);
  const tenantFromBody = readTenantId(input);
  const passengerFromBody = readPassengerId(input);

  if (!token) {
    return { ok: false, failure: { status: 401, error: "session_token_required" } };
  }

  const claims = await verifyPaxSessionToken(token);
  if (!claims) {
    return { ok: false, failure: { status: 401, error: "session_invalid_or_expired" } };
  }

  const tenantId = canonicalTenantId(claims.tenantId);
  const passengerId = String(claims.sub || "").trim();
  if (!tenantId || !passengerId) {
    return { ok: false, failure: { status: 401, error: "session_invalid" } };
  }

  if (
    (tenantFromBody && tenantFromBody !== tenantId)
    || (passengerFromBody && passengerFromBody !== passengerId)
  ) {
    return { ok: false, failure: { status: 403, error: "session_identity_mismatch" } };
  }

  return { ok: true, identity: { tenantId, passengerId, claims } };
}
