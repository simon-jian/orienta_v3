import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { PAX_SESSION_AUDIENCE, verifyPaxSessionToken } from "./paxSessionToken";
import { revokePaxSessionsForPassenger } from "../auth/paxSessionRevocation";
import { JWT_SECRET } from "../config";

const secret = new TextEncoder().encode(JWT_SECRET);

async function signPaxToken(
  passengerId: string,
  tenantId: string,
  overrides: Partial<{ iat: number }> = {},
): Promise<string> {
  let builder = new SignJWT({
    tenantId,
    accountType: "temporary",
    plan: "free",
    capabilities: ["navigate"],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(PAX_SESSION_AUDIENCE)
    .setAudience(PAX_SESSION_AUDIENCE)
    .setSubject(passengerId)
    .setExpirationTime("30m");
  builder = overrides.iat != null ? builder.setIssuedAt(overrides.iat) : builder.setIssuedAt();
  return builder.sign(secret);
}

describe("verifyPaxSessionToken", () => {
  it("accepts a well-formed token", async () => {
    const token = await signPaxToken("P1", "airchina");
    const payload = await verifyPaxSessionToken(token);
    expect(payload?.sub).toBe("P1");
    expect(payload?.tenantId).toBe("airchina");
  });

  it("rejects garbage input", async () => {
    expect(await verifyPaxSessionToken("")).toBeNull();
    expect(await verifyPaxSessionToken("not-a-jwt")).toBeNull();
  });
});

// Regression coverage for plan/capability changes not taking effect until a
// passenger's already-issued token naturally expires.
describe("passenger session revocation (plan change / delete)", () => {
  it("a token issued before revokePaxSessionsForPassenger() is rejected afterward", async () => {
    const passengerId = `P_revoke_${Math.random()}`;
    const tenantId = "airchina";
    const token = await signPaxToken(passengerId, tenantId);
    expect(await verifyPaxSessionToken(token)).not.toBeNull();

    await revokePaxSessionsForPassenger(tenantId, passengerId);

    expect(await verifyPaxSessionToken(token)).toBeNull();
  });

  it("a token issued AFTER the revocation cutover is still accepted (new session, not the stale one)", async () => {
    const passengerId = `P_revoke2_${Math.random()}`;
    const tenantId = "airchina";
    await revokePaxSessionsForPassenger(tenantId, passengerId);

    // Simulate the passenger logging in again right after the revocation.
    const freshToken = await signPaxToken(passengerId, tenantId, { iat: Math.floor(Date.now() / 1000) + 5 });
    expect(await verifyPaxSessionToken(freshToken)).not.toBeNull();
  });

  it("revoking one passenger's sessions does not affect a different passenger", async () => {
    const tenantId = "airchina";
    const passengerA = `P_a_${Math.random()}`;
    const passengerB = `P_b_${Math.random()}`;
    const tokenA = await signPaxToken(passengerA, tenantId);
    const tokenB = await signPaxToken(passengerB, tenantId);

    await revokePaxSessionsForPassenger(tenantId, passengerA);

    expect(await verifyPaxSessionToken(tokenA)).toBeNull();
    expect(await verifyPaxSessionToken(tokenB)).not.toBeNull();
  });

  it("the same passenger id in a DIFFERENT tenant is unaffected", async () => {
    const passengerId = `P_multi_tenant_${Math.random()}`;
    const tokenTenantA = await signPaxToken(passengerId, "airchina");
    const tokenTenantB = await signPaxToken(passengerId, "united");

    await revokePaxSessionsForPassenger("airchina", passengerId);

    expect(await verifyPaxSessionToken(tokenTenantA)).toBeNull();
    expect(await verifyPaxSessionToken(tokenTenantB)).not.toBeNull();
  });
});
