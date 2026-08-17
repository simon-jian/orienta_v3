import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { summarizeDevice, deviceSummaryLabel } from "./deviceSummary";

function req(userAgent: string, headers: Record<string, string> = {}): Request {
  return { headers: { "user-agent": userAgent, ...headers } } as unknown as Request;
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
// iPadOS Safari and desktop Safari send the identical string.
const MAC_LIKE_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";

describe("summarizeDevice", () => {
  it("reads iPhone OS version and browser", () => {
    expect(summarizeDevice(req(IPHONE_SAFARI))).toEqual({
      os: "iOS", osVersion: "17.5", browser: "Safari", isMobile: true,
    });
  });

  it("names Chrome on iOS by its brand, not the WebKit engine underneath", () => {
    expect(summarizeDevice(req(IPHONE_CHROME)).browser).toBe("Chrome");
  });

  it("reads Android version", () => {
    expect(summarizeDevice(req(ANDROID_CHROME))).toEqual({
      os: "Android", osVersion: "14", browser: "Chrome", isMobile: true,
    });
  });

  it("prefers Samsung Internet over the Chrome token it also carries", () => {
    expect(summarizeDevice(req(ANDROID_SAMSUNG)).browser).toBe("Samsung Internet");
  });

  it("prefers Edge over the Chrome token it also carries", () => {
    expect(summarizeDevice(req(WINDOWS_EDGE))).toEqual({
      os: "Windows", osVersion: "", browser: "Edge", isMobile: false,
    });
  });

  it("tells an iPad from a Mac by touch points, since their UA is identical", () => {
    expect(summarizeDevice(req(MAC_LIKE_SAFARI), { touchPoints: 5 })).toEqual({
      os: "iPadOS", osVersion: "", browser: "Safari", isMobile: true,
    });
    expect(summarizeDevice(req(MAC_LIKE_SAFARI), { touchPoints: 0 })).toEqual({
      os: "macOS", osVersion: "", browser: "Safari", isMobile: false,
    });
  });

  it("trusts the client hint for mobile over UA guessing", () => {
    expect(summarizeDevice(req(WINDOWS_EDGE, { "sec-ch-ua-mobile": "?1" })).isMobile).toBe(true);
    expect(summarizeDevice(req(ANDROID_CHROME, { "sec-ch-ua-mobile": "?0" })).isMobile).toBe(false);
  });

  it("fills a missing OS version from the platform-version hint", () => {
    const summary = summarizeDevice(
      req(WINDOWS_EDGE, { "sec-ch-ua-platform": '"Windows"', "sec-ch-ua-platform-version": "15.0.0" }),
    );
    expect(summary).toMatchObject({ os: "Windows", osVersion: "15.0" });
  });

  it("returns empty rather than guessing when there is no User-Agent", () => {
    expect(summarizeDevice(req(""))).toEqual({ os: "", osVersion: "", browser: "", isMobile: false });
  });
});

describe("deviceSummaryLabel", () => {
  it("joins what is known", () => {
    expect(deviceSummaryLabel({ os: "iOS", osVersion: "17.5", browser: "Safari", isMobile: true }))
      .toBe("iOS 17.5 · Safari");
    expect(deviceSummaryLabel({ os: "Windows", osVersion: "", browser: "Edge", isMobile: false }))
      .toBe("Windows · Edge");
  });

  it("is empty when nothing is known", () => {
    expect(deviceSummaryLabel(null)).toBe("");
    expect(deviceSummaryLabel({ os: "", osVersion: "", browser: "", isMobile: false })).toBe("");
  });
});
