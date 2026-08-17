/**
 * Normalized "what phone is this" summary, for the support desk.
 *
 * Kept deliberately coarse — OS, OS version, browser family, phone-or-not — and
 * derived, never the raw `User-Agent`: the full string is fingerprinting
 * material with no operational value here, while these four fields answer the
 * questions that actually come up. Which device is the invite bound to? Can this
 * passenger receive Web Push at all (iOS needs 16.4+ and a home-screen install)?
 *
 * UA parsing is heuristic by nature and this makes no attempt at completeness:
 * an unrecognized client yields empty strings rather than a wrong guess.
 */
import type { Request } from "express";

export type DeviceSummary = {
  /** "iOS" | "iPadOS" | "Android" | "Windows" | "macOS" | "Linux" | "" */
  os: string;
  /** Major(.minor) only, e.g. "17.5"; empty when the client doesn't say. */
  osVersion: string;
  /** "Safari" | "Chrome" | "Edge" | "Firefox" | "Samsung Internet" | "" */
  browser: string;
  isMobile: boolean;
};

export const EMPTY_DEVICE_SUMMARY: DeviceSummary = { os: "", osVersion: "", browser: "", isMobile: false };

/** Client hints arrive quoted (`"Android"`); Chromium sends platform/mobile by default. */
function hint(req: Request, name: string): string {
  return String(req.headers[name] || "").replace(/^"|"$/g, "").trim();
}

function browserFrom(ua: string): string {
  // Order matters: every Chromium browser also claims "Chrome", and every
  // WebKit-family browser also claims "Safari".
  if (/\bEdgi?A?\/|\bEdg\//.test(ua)) return "Edge";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  // CriOS / FxiOS are Chrome and Firefox on iOS, where both are WebKit under
  // the hood but are still the app the passenger is looking at.
  if (/\bCriOS\//.test(ua)) return "Chrome";
  if (/\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bSafari\//.test(ua)) return "Safari";
  return "";
}

function osFrom(ua: string, platformHint: string, touchPoints: number): { os: string; osVersion: string } {
  const iosVersion = /OS (\d+)[._](\d+)/.exec(ua);
  const version = iosVersion ? `${iosVersion[1]}.${iosVersion[2]}` : "";

  if (/\biPad\b/.test(ua)) return { os: "iPadOS", osVersion: version };
  if (/\biPhone\b|\biPod\b/.test(ua)) return { os: "iOS", osVersion: version };

  const android = /\bAndroid (\d+(?:\.\d+)?)/.exec(ua);
  if (android) return { os: "Android", osVersion: android[1] ?? "" };

  if (/\bMacintosh\b/.test(ua)) {
    // Safari on iPadOS 13+ presents a desktop Mac UA, so a "Mac" with a
    // touchscreen is really an iPad. Macs report maxTouchPoints 0.
    if (touchPoints > 1) return { os: "iPadOS", osVersion: "" };
    const mac = /Mac OS X (\d+)[._](\d+)/.exec(ua);
    // 10_15_7 is frozen by Safari and says nothing about the real version.
    const macVersion = mac && mac[1] !== "10" ? `${mac[1]}.${mac[2]}` : "";
    return { os: "macOS", osVersion: macVersion };
  }

  if (/\bWindows NT\b/.test(ua)) return { os: "Windows", osVersion: "" };
  if (/\bCrOS\b/.test(ua)) return { os: "ChromeOS", osVersion: "" };
  if (/\bLinux\b/.test(ua)) return { os: "Linux", osVersion: "" };

  // No UA match: fall back to whatever the client hint claimed.
  return { os: platformHint, osVersion: "" };
}

/**
 * `touchPoints` is `navigator.maxTouchPoints`, which only the client can see and
 * is the sole way to tell an iPad from a Mac in Safari.
 */
export function summarizeDevice(req: Request, opts?: { touchPoints?: number }): DeviceSummary {
  const ua = String(req.headers["user-agent"] || "");
  if (!ua) return EMPTY_DEVICE_SUMMARY;

  const platformHint = hint(req, "sec-ch-ua-platform");
  const mobileHint = hint(req, "sec-ch-ua-mobile");
  const touchPoints = Number.isFinite(opts?.touchPoints) ? Number(opts?.touchPoints) : 0;

  const { os, osVersion } = osFrom(ua, platformHint, touchPoints);
  const hintedVersion = hint(req, "sec-ch-ua-platform-version");

  return {
    os,
    osVersion: osVersion || (hintedVersion && os ? hintedVersion.split(".").slice(0, 2).join(".") : ""),
    browser: browserFrom(ua),
    isMobile: mobileHint ? mobileHint === "?1" : /\bMobi|\bAndroid\b|\biPhone\b|\biPad\b/.test(ua) || touchPoints > 1,
  };
}

/** Operator-facing one-liner, e.g. "iPhone · iOS 17.5 · Safari". */
export function deviceSummaryLabel(summary: DeviceSummary | null): string {
  if (!summary || (!summary.os && !summary.browser)) return "";
  const os = [summary.os, summary.osVersion].filter(Boolean).join(" ");
  return [os, summary.browser].filter(Boolean).join(" · ");
}
