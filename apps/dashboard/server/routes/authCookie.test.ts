import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { authCookieSecure } from "./auth";

/**
 * The admin cookie used to be marked `Secure` whenever NODE_ENV was
 * "production", regardless of how the request actually arrived. A production
 * image served over plain HTTP — the LAN/demo case, opened as
 * http://<ip>:5174 — then set a cookie the browser refused to store: the login
 * POST returned 200, the UI rendered from its cached session, and every
 * following API call came back `not_authenticated`.
 */
function req(secure: boolean): Request {
  return { secure } as Request;
}

describe("authCookieSecure", () => {
  it("marks the cookie Secure for a TLS request", () => {
    expect(authCookieSecure(req(true))).toBe(true);
  });

  it("omits Secure over plain HTTP so the browser stores the cookie", () => {
    expect(authCookieSecure(req(false))).toBe(false);
  });

  it("does not depend on NODE_ENV", () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(authCookieSecure(req(false))).toBe(false);
      expect(authCookieSecure(req(true))).toBe(true);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
