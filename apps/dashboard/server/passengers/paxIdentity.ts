/**
 * Resolves passenger identity from HTTP headers and request fields.
 */
import { PAX_LEGACY_AUTH, ROUTE_SITE_DEFAULT_TENANT } from "../config";
import {
  bearerTokenFromHeader,
  verifyPaxSessionToken,
  type PaxSessionClaims,
} from "./paxSessionToken";

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
  return String(input.tenantId || input.tenant_id || ROUTE_SITE_DEFAULT_TENANT).trim();
}

function readPassengerId(input: PaxIdentityInput): string {
  return String(input.passengerId || input.passenger_id || "").trim();
}

/**
 * Validates passenger identity for HTTP routes and WS hello frames.
 * Returns claims when a session JWT is present; legacy mode allows passengerId only.
 */
export async function resolvePaxIdentity(
  input: PaxIdentityInput,
): Promise<{ ok: true; identity: PaxResolvedIdentity } | { ok: false; failure: PaxIdentityFailure }> {
  const token = bearerTokenFromHeader(input.authorizationHeader);
  const tenantFromBody = readTenantId(input);
  const passengerFromBody = readPassengerId(input);

  if (!token) {
    if (!PAX_LEGACY_AUTH) {
      return { ok: false, failure: { status: 401, error: "session_token_required" } };
    }
    if (!passengerFromBody) {
      return { ok: false, failure: { status: 400, error: "missing_passenger_id" } };
    }
    return {
      ok: true,
      identity: { tenantId: tenantFromBody, passengerId: passengerFromBody, claims: null },
    };
  }

  const claims = await verifyPaxSessionToken(token);
  if (!claims) {
    return { ok: false, failure: { status: 401, error: "session_invalid_or_expired" } };
  }

  const tenantId = String(claims.tenantId || "");
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
