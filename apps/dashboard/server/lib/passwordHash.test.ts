import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHash";

describe("passwordHash", () => {
  it("hashes and verifies a password", () => {
    const encoded = hashPassword("secret-pass");
    expect(encoded.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("secret-pass", encoded)).toBe(true);
    expect(verifyPassword("wrong-pass", encoded)).toBe(false);
  });

  it("rejects malformed encodings", () => {
    expect(verifyPassword("secret", "bcrypt$abc$def")).toBe(false);
    expect(verifyPassword("secret", "scrypt$only-two-parts")).toBe(false);
  });
});
