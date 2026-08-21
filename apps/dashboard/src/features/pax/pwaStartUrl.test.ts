import { describe, expect, it } from "vitest";
import { passengerPwaStartUrl } from "./pwaStartUrl";

describe("passengerPwaStartUrl", () => {
  it("keeps a claim link that still has invite id and secret", () => {
    expect(passengerPwaStartUrl("/pax/claim", "?i=inv_abc&t=secret")).toBe(
      "/pax/claim?i=inv_abc&t=secret",
    );
  });

  it("does not pin a stripped claim page", () => {
    expect(passengerPwaStartUrl("/pax/claim", "")).toBe("/pax/app");
    expect(passengerPwaStartUrl("/pax/claim", "?i=inv_abc")).toBe("/pax/app");
  });

  it("sends the entry and login pages to the app", () => {
    expect(passengerPwaStartUrl("/pax")).toBe("/pax/app");
    expect(passengerPwaStartUrl("/pax/login")).toBe("/pax/app");
  });

  it("keeps the current passenger app / flight URL", () => {
    expect(passengerPwaStartUrl("/pax/app", "?tab=nav")).toBe("/pax/app?tab=nav");
    expect(passengerPwaStartUrl("/pax/flight")).toBe("/pax/flight");
  });
});
