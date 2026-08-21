import { describe, expect, it } from "vitest";
import { readClaimToken } from "./claimToken";

describe("readClaimToken", () => {
  it("reads ?t= when a scanner or mail client dropped the fragment", () => {
    expect(readClaimToken("?i=inv_1&t=secret-token", "")).toBe("secret-token");
    expect(readClaimToken("?i=inv_1&t=secret-token", "#t=ignored")).toBe("secret-token");
  });

  it("falls back to #t= for older links", () => {
    expect(readClaimToken("?i=inv_1", "#t=secret-token")).toBe("secret-token");
  });

  it("returns empty when neither form is present", () => {
    expect(readClaimToken("?i=inv_1", "")).toBe("");
  });
});
