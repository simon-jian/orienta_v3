import { describe, expect, it } from "vitest";
import { titleForPath } from "./documentTitle";

describe("titleForPath", () => {
  it("names the passenger app on every /pax route in Chinese", () => {
    for (const path of ["/pax", "/pax/", "/pax/login", "/pax/claim", "/pax/flight", "/pax/app"]) {
      expect(titleForPath(path, "zh")).toBe("Orienta 旅客端");
    }
  });

  it("uses a different passenger title in English than in Chinese", () => {
    expect(titleForPath("/pax", "en")).toBe("Orienta Passenger");
    expect(titleForPath("/pax", "en")).not.toBe(titleForPath("/pax", "zh"));
    expect(titleForPath("/arrival/abc123", "en")).not.toBe(titleForPath("/arrival/abc123", "zh"));
  });

  it("never shows the operator console name to a passenger", () => {
    // An invite link is the first thing a passenger sees; the tab used to read
    // "Orienta公司后台" there.
    expect(titleForPath("/pax/claim", "zh")).not.toContain("后台");
    expect(titleForPath("/pax/claim", "en")).not.toContain("后台");
  });

  it("labels the public arrival share separately", () => {
    expect(titleForPath("/arrival/abc123", "zh")).toBe("Orienta 到达信息");
    expect(titleForPath("/arrival/abc123", "en")).toBe("Orienta Arrival");
  });

  it("keeps the operator console title everywhere else", () => {
    expect(titleForPath("/")).toBe("中国国际航空公司 · Orienta 后台");
    expect(titleForPath("/dashboard")).toBe("中国国际航空公司 · Orienta 后台");
  });

  it("is case-insensitive and tolerates an empty path", () => {
    expect(titleForPath("/PAX/App", "zh")).toBe("Orienta 旅客端");
    expect(titleForPath("")).toBe("中国国际航空公司 · Orienta 后台");
  });
});
