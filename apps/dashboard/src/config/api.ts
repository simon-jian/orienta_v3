/**
 * Sub-path-aware URL helpers for the React app (P1-9).
 *
 * Mirrors public/orienta-base.js: when the app is deployed under a base path
 * (e.g. `/orienta`), `window.__ORIENTA_BASE__` is set by orienta-base.js and we
 * prefix API/WS URLs accordingly. orienta-base.js already patches `fetch`/XHR,
 * but the `WebSocket` constructor is NOT patched — so `wsUrl()` is the helper
 * that actually fixes realtime under a sub-path.
 */
function basePath(): string {
  const b = (globalThis as { __ORIENTA_BASE__?: unknown }).__ORIENTA_BASE__;
  if (typeof b !== "string") return "";
  const s = b.trim();
  if (!s || s === "/") return "";
  return (s.charAt(0) === "/" ? s : "/" + s).replace(/\/+$/, "");
}

/** Resolve an app-relative path to an absolute path including any deploy base. */
export function apiUrl(path: string): string {
  if (!path) return basePath() || "/";
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.charAt(0) === "/" ? path : "/" + path;
  const b = basePath();
  if (b && p.indexOf(b + "/") === 0) return p; // already prefixed
  return (b || "") + p;
}

/** Build a WebSocket URL (default `/ws`) honoring protocol + deploy base. */
export function wsUrl(path = "/ws"): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${apiUrl(path)}`;
}
