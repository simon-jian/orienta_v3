import { describe, expect, it } from "vitest";
import { isAllowedPdrProxyPath, isAllowedPdrUpgradePath } from "./pdrProxyGuard";

describe("isAllowedPdrProxyPath", () => {
  it("allows the passenger client surface", () => {
    expect(isAllowedPdrProxyPath("GET", "/health")).toBe(true);
    expect(isAllowedPdrProxyPath("GET", "/api/config")).toBe(true);
    expect(isAllowedPdrProxyPath("POST", "/api/session")).toBe(true);
    expect(isAllowedPdrProxyPath("DELETE", "/api/session/abc-123")).toBe(true);
    expect(isAllowedPdrProxyPath("GET", "/ws/pdr/abc-123")).toBe(true);
  });

  it("blocks recompute, export, and static HTML", () => {
    expect(isAllowedPdrProxyPath("POST", "/api/recompute")).toBe(false);
    expect(isAllowedPdrProxyPath("GET", "/api/session/abc/export")).toBe(false);
    expect(isAllowedPdrProxyPath("GET", "/")).toBe(false);
    expect(isAllowedPdrProxyPath("GET", "/pdr.html")).toBe(false);
    expect(isAllowedPdrProxyPath("GET", "/index.html")).toBe(false);
  });

  it("ignores query strings and trailing slashes", () => {
    expect(isAllowedPdrProxyPath("GET", "/health?x=1")).toBe(true);
    expect(isAllowedPdrProxyPath("POST", "/api/session/")).toBe(true);
  });
});

describe("isAllowedPdrUpgradePath", () => {
  it("accepts /pdr-api/ws/pdr/:id", () => {
    expect(isAllowedPdrUpgradePath("/pdr-api/ws/pdr/sid")).toBe(true);
    expect(isAllowedPdrUpgradePath("/pdr-api/api/recompute")).toBe(false);
  });
});
