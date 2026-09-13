import { describe, expect, it } from "vitest";
import { detectPaxLocale, dictionaries, interpolate, paxMessage, PAX_LOCALES } from "./locales";
import { en } from "./messages/en";

describe("detectPaxLocale", () => {
  it("maps Chinese variants to zh", () => {
    expect(detectPaxLocale("zh-Hans-CN")).toBe("zh");
    expect(detectPaxLocale("zh-TW")).toBe("zh");
  });

  it("maps French, Arabic, and other supported prefixes", () => {
    expect(detectPaxLocale("fr-FR")).toBe("fr");
    expect(detectPaxLocale("ar-SA")).toBe("ar");
    expect(detectPaxLocale("ja-JP")).toBe("ja");
  });

  it("falls back to English for unsupported languages", () => {
    expect(detectPaxLocale("pt-BR")).toBe("en");
    expect(detectPaxLocale("it-IT")).toBe("en");
  });

  it("uses only the first navigator language", () => {
    expect(detectPaxLocale(["pt-BR", "zh-CN"])).toBe("en");
    expect(detectPaxLocale(["de-DE", "en-US"])).toBe("de");
  });
});

describe("passenger dictionaries", () => {
  it("covers every English key in all nine locales", () => {
    const keys = Object.keys(en);
    for (const locale of PAX_LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(keys.slice().sort());
    }
  });

  it("interpolates placeholders", () => {
    expect(interpolate("Flight {flight}", { flight: "CA986" })).toBe("Flight CA986");
    expect(paxMessage("en", "nav.planFlightHint", { flight: "CA986" })).toContain("CA986");
  });
});
