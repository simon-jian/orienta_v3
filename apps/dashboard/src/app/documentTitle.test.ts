import { describe, expect, it } from "vitest";
import { titleForPath } from "./documentTitle";

describe("titleForPath", () => {
  it("names the passenger app on every /pax route", () => {
    for (const path of ["/pax", "/pax/", "/pax/login", "/pax/claim", "/pax/flight", "/pax/app"]) {
      expect(titleForPath(path)).toBe("Orienta 旅客端");
    }
  });

  it("never shows the operator console name to a passenger", () => {
    // An invite link is the first thing a passenger sees; the tab used to read
    // "Orienta公司后台" there.
    expect(titleForPath("/pax/claim")).not.toContain("后台");
  });

  it("labels the public arrival share separately", () => {
    expect(titleForPath("/arrival/abc123")).toBe("Orienta 到达信息");
  });

  it("keeps the operator console title everywhere else", () => {
    expect(titleForPath("/")).toBe("中国国际航空公司 · Orienta 后台");
    expect(titleForPath("/dashboard")).toBe("中国国际航空公司 · Orienta 后台");
  });

  it("is case-insensitive and tolerates an empty path", () => {
    expect(titleForPath("/PAX/App")).toBe("Orienta 旅客端");
    expect(titleForPath("")).toBe("中国国际航空公司 · Orienta 后台");
  });
});
