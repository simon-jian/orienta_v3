import { describe, expect, it } from "vitest";
import { buildInviteClaimUrl, claimTokenFromUrl } from "./inviteClaimUrl";

describe("buildInviteClaimUrl / claimTokenFromUrl", () => {
  const origin = "https://ops.example.com";
  const url = buildInviteClaimUrl(origin, "inv_1", "secret-token");

  it("puts the secret in both the query and the fragment", () => {
    expect(url).toContain("/pax/claim?i=inv_1&t=secret-token");
    expect(url).toContain("#t=secret-token");
  });

  it("reads the token after a client strips the fragment", () => {
    const stripped = new URL(url);
    stripped.hash = "";
    expect(claimTokenFromUrl(stripped)).toBe("secret-token");
  });
});
