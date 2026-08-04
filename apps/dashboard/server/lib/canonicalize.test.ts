import { describe, expect, it } from "vitest";
import { canonicalTenantId, canonicalFlightId, canonicalGateId } from "./canonicalize";

describe("canonicalTenantId", () => {
  it("lowercases and trims", () => {
    expect(canonicalTenantId("AirChina")).toBe("airchina");
    expect(canonicalTenantId("  AIRCHINA  ")).toBe("airchina");
  });

  it("treats different-case inputs as identical", () => {
    expect(canonicalTenantId("AirChina")).toBe(canonicalTenantId("airchina"));
    expect(canonicalTenantId("AIRCHINA")).toBe(canonicalTenantId("airchina"));
  });

  it("handles non-string/missing input without throwing", () => {
    expect(canonicalTenantId(undefined)).toBe("");
    expect(canonicalTenantId(null)).toBe("");
    expect(canonicalTenantId(123)).toBe("123");
  });
});

describe("canonicalFlightId", () => {
  it("uppercases, trims, and strips internal whitespace", () => {
    expect(canonicalFlightId("ca123")).toBe("CA123");
    expect(canonicalFlightId("  ca 123  ")).toBe("CA123");
  });

  it("treats different-case inputs as identical (regression: basic-session id collision)", () => {
    expect(canonicalFlightId("ca123")).toBe(canonicalFlightId("CA123"));
  });
});

describe("canonicalGateId", () => {
  it("uppercases and trims", () => {
    expect(canonicalGateId("e32")).toBe("E32");
    expect(canonicalGateId("  e32  ")).toBe("E32");
  });
});
