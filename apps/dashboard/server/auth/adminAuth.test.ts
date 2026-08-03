import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { ADMIN_TOKEN_AUDIENCE, verifyAdminToken } from "./adminAuth";
import { PAX_SESSION_AUDIENCE } from "../passengers/paxSessionToken";
import { JWT_SECRET } from "../config";

// Regression coverage for the admin/passenger token-confusion fix: both token
// kinds are signed with the same JWT_SECRET, so verifyAdminToken must reject
// anything that isn't specifically an admin token (right issuer/audience AND
// a recognized role) — not just anything with a valid signature. Before this
// fix, a passenger session self-issued via the unauthenticated
// POST /api/pax/basic-session verified successfully as an admin cookie.

const secret = new TextEncoder().encode(JWT_SECRET);

async function signAdminToken(overrides: Partial<{ role: string; aud: string; iss: string }> = {}): Promise<string> {
  return new SignJWT({ role: overrides.role ?? "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(overrides.iss ?? ADMIN_TOKEN_AUDIENCE)
    .setAudience(overrides.aud ?? ADMIN_TOKEN_AUDIENCE)
    .setSubject("admin@test.com")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

async function signPaxSessionToken(): Promise<string> {
  return new SignJWT({ tenantId: "airchina", accountType: "temporary", plan: "free", capabilities: [] })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(PAX_SESSION_AUDIENCE)
    .setAudience(PAX_SESSION_AUDIENCE)
    .setSubject("BASIC_TEST")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret);
}

describe("verifyAdminToken", () => {
  it("accepts a real admin token", async () => {
    const token = await signAdminToken({ role: "admin" });
    const payload = await verifyAdminToken(token);
    expect(payload?.role).toBe("admin");
  });

  it("accepts ops/viewer roles", async () => {
    expect((await verifyAdminToken(await signAdminToken({ role: "ops" })))?.role).toBe("ops");
    expect((await verifyAdminToken(await signAdminToken({ role: "viewer" })))?.role).toBe("viewer");
  });

  it("rejects a passenger session token, even though it's signed with the same secret", async () => {
    const paxToken = await signPaxSessionToken();
    expect(await verifyAdminToken(paxToken)).toBeNull();
  });

  it("rejects a token with the admin audience but no recognized role", async () => {
    const token = await signAdminToken({ role: "not_a_real_role" });
    expect(await verifyAdminToken(token)).toBeNull();
  });

  it("rejects a token signed with the right role but the wrong issuer/audience", async () => {
    const token = await signAdminToken({ role: "admin", iss: "some-other-issuer", aud: "some-other-issuer" });
    expect(await verifyAdminToken(token)).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifyAdminToken("")).toBeNull();
    expect(await verifyAdminToken("not-a-jwt")).toBeNull();
  });
});
