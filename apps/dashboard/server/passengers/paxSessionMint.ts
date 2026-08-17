/**
 * Passenger session minting.
 *
 * Extracted from routes/paxSessions.ts so every entry point that authenticates
 * a passenger — BCBP scan, basic/premium login, and device-bound invite links —
 * issues tokens with identical claims. Diverging claim sets here would produce
 * sessions the WS hello and capability gates treat inconsistently.
 */
import crypto from "node:crypto";
import { SignJWT } from "jose";
import { JWT_SECRET } from "../config";
import { PAX_SESSION_AUDIENCE } from "./paxSessionToken";
import { airportForTenant } from "../../src/config/tenants/registry";
import type { PassengerRecord } from "./PassengerRegistry";
import type { PaxPlan } from "../../src/types/types";

export type AccountType = "temporary" | "registered";

export type PaxCapability =
  | "navigate"
  | "receive_notifications"
  | "share_location"
  | "operator_chat";

export type PaxSessionResponse = {
  token: string;
  passenger: PassengerRecord;
  accountType: AccountType;
  plan: PaxPlan;
  capabilities: PaxCapability[];
  expiresAt: number;
};

export const TEMP_SESSION_MIN_TTL_MS = 30 * 60_000;
export const TEMP_SESSION_GRACE_MS = 2 * 60 * 60_000;
export const REGISTERED_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export function capabilitiesFor(plan: PaxPlan): PaxCapability[] {
  const base: PaxCapability[] = ["navigate", "receive_notifications", "share_location"];
  return plan === "premium" ? [...base, "operator_chat"] : base;
}

/** Keep a temporary session alive until well past its flight's departure. */
export function temporaryExpiryFromDeparture(scheduledDepMs: number): number {
  return Math.max(Date.now() + TEMP_SESSION_MIN_TTL_MS, scheduledDepMs + TEMP_SESSION_GRACE_MS);
}

export async function signPaxSession(input: {
  passengerId: string;
  tenantId: string;
  airportId: string;
  accountType: AccountType;
  plan: PaxPlan;
  capabilities: PaxCapability[];
  expiresAt: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const sessionId = crypto.randomUUID();
  return new SignJWT({
    sid: sessionId,
    tenantId: input.tenantId,
    airportId: input.airportId,
    accountType: input.accountType,
    plan: input.plan,
    capabilities: input.capabilities,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(PAX_SESSION_AUDIENCE)
    .setAudience(PAX_SESSION_AUDIENCE)
    .setSubject(input.passengerId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(input.expiresAt / 1000))
    .sign(secret);
}

export async function createSessionResponse(input: {
  passenger: PassengerRecord;
  tenantId: string;
  accountType: AccountType;
  plan: PaxPlan;
  expiresAt: number;
}): Promise<PaxSessionResponse> {
  const capabilities = capabilitiesFor(input.plan);
  const token = await signPaxSession({
    passengerId: input.passenger.id,
    tenantId: input.tenantId,
    airportId: airportForTenant(input.tenantId),
    accountType: input.accountType,
    plan: input.plan,
    capabilities,
    expiresAt: input.expiresAt,
  });
  return {
    token,
    passenger: input.passenger,
    accountType: input.accountType,
    plan: input.plan,
    capabilities,
    expiresAt: input.expiresAt,
  };
}
