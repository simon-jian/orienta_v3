import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./passwordHash";

describe("passwordHash", () => {
  it("hashes and verifies a password", async () => {
    const encoded = await hashPassword("secret-pass");
    expect(encoded.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("secret-pass", encoded)).toBe(true);
    expect(await verifyPassword("wrong-pass", encoded)).toBe(false);
  });

  it("rejects malformed encodings", async () => {
    expect(await verifyPassword("secret", "bcrypt$abc$def")).toBe(false);
    expect(await verifyPassword("secret", "scrypt$only-two-parts")).toBe(false);
  });

  it("DUMMY_PASSWORD_HASH is well-formed but never matches any password", async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("takes comparable time whether or not a real hash exists (timing side-channel regression)", async () => {
    const real = await hashPassword("a-real-password");
    const iterations = 8;

    const timeIt = async (encoded: string) => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) await verifyPassword("guess", encoded);
      return Number(process.hrtime.bigint() - start) / 1e6; // ms
    };

    const realMs = await timeIt(real);
    const dummyMs = await timeIt(DUMMY_PASSWORD_HASH);
    // Both paths run the same scrypt cost; allow generous slack for CI jitter —
    // this only needs to catch a regression back to "skip scrypt entirely
    // when there's no real hash", which would show as a large (>5x) gap.
    expect(dummyMs).toBeGreaterThan(realMs / 5);
    expect(dummyMs).toBeLessThan(realMs * 5);
  });
});
