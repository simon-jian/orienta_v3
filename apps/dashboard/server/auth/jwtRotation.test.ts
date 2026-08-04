import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

// JWT_VERIFICATION_SECRETS is derived from JWT_SECRET/JWT_SECRET_PREVIOUS at
// module-load time (server/config.ts), so each test that needs a specific
// rotation setup gets a fresh module instance via resetModules() + dynamic
// import after stubbing the env.
async function importFreshWithSecrets(current: string, previous?: string) {
  vi.resetModules();
  vi.stubEnv("JWT_SECRET", current);
  vi.stubEnv("JWT_SECRET_PREVIOUS", previous ?? "");
  return import("./jwtRotation");
}

async function sign(secret: string): Promise<string> {
  return new SignJWT({ hello: "world" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("test-iss")
    .setAudience("test-iss")
    .setSubject("subject")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

describe("verifyWithRotatingSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies a token signed with the current secret", async () => {
    const { verifyWithRotatingSecret } = await importFreshWithSecrets("current-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    const token = await sign("current-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    const payload = await verifyWithRotatingSecret(token, { issuer: "test-iss", audience: "test-iss" });
    expect(payload.sub).toBe("subject");
  });

  it("still verifies a token signed with a JWT_SECRET_PREVIOUS value after rotation", async () => {
    const { verifyWithRotatingSecret } = await importFreshWithSecrets(
      "new-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb",
      "old-secret-cccccccccccccccccccccccccc",
    );
    const oldToken = await sign("old-secret-cccccccccccccccccccccccccc");
    const payload = await verifyWithRotatingSecret(oldToken, { issuer: "test-iss", audience: "test-iss" });
    expect(payload.sub).toBe("subject");
  });

  it("rejects a token signed with a secret that isn't current or previous", async () => {
    const { verifyWithRotatingSecret } = await importFreshWithSecrets(
      "new-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb",
      "old-secret-cccccccccccccccccccccccccc",
    );
    const unrelatedToken = await sign("some-totally-different-secret-dddddddd");
    await expect(
      verifyWithRotatingSecret(unrelatedToken, { issuer: "test-iss", audience: "test-iss" }),
    ).rejects.toThrow();
  });

  it("supports multiple comma-separated previous secrets (two rotations back)", async () => {
    const { verifyWithRotatingSecret } = await importFreshWithSecrets(
      "newest-secret-eeeeeeeeeeeeeeeeeeeeeeee",
      "middle-secret-ffffffffffffffffffffffff,oldest-secret-gggggggggggggggggggggggg",
    );
    const oldestToken = await sign("oldest-secret-gggggggggggggggggggggggg");
    const payload = await verifyWithRotatingSecret(oldestToken, { issuer: "test-iss", audience: "test-iss" });
    expect(payload.sub).toBe("subject");
  });
});
