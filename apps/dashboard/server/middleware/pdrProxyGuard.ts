/**
 * Path allowlist for the /pdr-api reverse proxy.
 *
 * The dashboard must not expose the full PDR surface (especially CPU-heavy
 * POST /api/recompute and session export) to the public internet. Only the
 * routes the passenger PDR client needs are forwarded.
 */
import type { RequestHandler } from "express";

/** Paths as seen by middleware mounted at `/pdr-api` (mount prefix already stripped). */
export function isAllowedPdrProxyPath(method: string, path: string): boolean {
  const m = method.toUpperCase();
  // Strip query string; normalize trailing slash (except root).
  const raw = (path.split("?")[0] || "/").trim() || "/";
  const p = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;

  if (m === "GET" && (p === "/health" || p === "/api/config")) return true;
  if (m === "POST" && p === "/api/session") return true;
  if (m === "DELETE" && /^\/api\/session\/[^/]+$/.test(p)) return true;
  // WebSocket upgrade arrives as GET with Upgrade header; also used for the
  // HTTP server's upgrade handler path check (full /pdr-api/ws/... or stripped).
  if (m === "GET" && /^\/ws\/pdr\/[^/]+$/.test(p)) return true;

  return false;
}

/** Full request URL path including `/pdr-api` prefix (used by WS upgrade). */
export function isAllowedPdrUpgradePath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "";
  const stripped = p.replace(/^\/pdr-api(?=\/|$)/, "") || "/";
  return isAllowedPdrProxyPath("GET", stripped);
}

export function pdrProxyAllowlist(): RequestHandler {
  return (req, res, next) => {
    const path = req.url || req.path || "/";
    if (!isAllowedPdrProxyPath(req.method, path)) {
      res.status(403).json({
        ok: false,
        error: "pdr_path_forbidden",
        message: "This PDR endpoint is not exposed through the dashboard proxy.",
      });
      return;
    }
    next();
  };
}
