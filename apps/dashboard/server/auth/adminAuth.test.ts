import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { ADMIN_TOKEN_AUDIENCE, adminAllowedForTenant, verifyAdminToken } from "./adminAuth";
import { revokeAdminToken } from "./adminSessionRevocation";
import { PAX_SESSION_AUDIENCE } from "../passengers/paxSessionToken";
import { JWT_SECRET } from "../config";

// Regression coverage for the admin/passenger token-confusion fix: both token
// kinds are signed with the same JWT_SECRET, so verifyAdminToken must reject
// anything that isn't specifically an admin token (right issuer/audience AND
// a recognized role) — not just anything with a valid signature. Before this
// fix, a passenger session self-issued via the unauthenticated
// POST /api/pax/basic-session verified successfully as an admin cookie.

const secret = new TextEncoder().encode(JWT_SECRET);

async function signAdminToken(
  overrides: Partial<{ role: string; aud: string; iss: string; jti: string }> = {},
): Promise<string> {
  return new SignJWT({ role: overrides.role ?? "admin", ...(overrides.jti ? { jti: overrides.jti } : {}) })
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

// Regression coverage for admin tenant scoping (config.ts ADMIN_TENANT_SCOPES):
// before this, any valid admin/ops/viewer credential could read or act on
// every tenant in the deployment, regardless of which one(s) it was meant to
// operate.
describe("adminAllowedForTenant", () => {
  it("allows any tenant when the token carries no tenants claim (legacy/unscoped admin)", async () => {
    const payload = await verifyAdminToken(await signAdminToken({ role: "admin" }));
    expect(adminAllowedForTenant(payload!, "airchina")).toBe(true);
    expect(adminAllowedForTenant(payload!, "some-other-tenant")).toBe(true);
  });

  it("restricts to the listed tenants when the token carries a tenants claim", () => {
    const scoped = { role: "admin", tenants: ["airchina", "united"] };
    expect(adminAllowedForTenant(scoped, "airchina")).toBe(true);
    expect(adminAllowedForTenant(scoped, "united")).toBe(true);
    expect(adminAllowedForTenant(scoped, "delta")).toBe(false);
  });

  it("treats an empty tenants array as unscoped, not as 'no tenants allowed'", () => {
    expect(adminAllowedForTenant({ role: "admin", tenants: [] }, "airchina")).toBe(true);
  });
});

// Regression coverage for POST /api/auth/logout actually invalidating the
// token immediately, rather than only clearing the browser's cookie.
describe("admin session revocation", () => {
  it("a revoked token is rejected even though its signature/issuer/role are all valid", async () => {
    const jti = `test-jti-${Math.random()}`;
    const token = await signAdminToken({ role: "admin", jti });
    expect((await verifyAdminToken(token))?.role).toBe("admin"); // valid before revocation

    await revokeAdminToken(jti, Date.now() + 60_000);

    expect(await verifyAdminToken(token)).toBeNull();
  });

  it("revoking one token does not affect a different token (different jti)", async () => {
    const tokenA = await signAdminToken({ role: "admin", jti: `jti-a-${Math.random()}` });
    const tokenB = await signAdminToken({ role: "admin", jti: `jti-b-${Math.random()}` });

    const payloadA = await verifyAdminToken(tokenA);
    await revokeAdminToken(String(payloadA!.jti), Date.now() + 60_000);

    expect(await verifyAdminToken(tokenA)).toBeNull();
    expect(await verifyAdminToken(tokenB)).not.toBeNull();
  });
});
