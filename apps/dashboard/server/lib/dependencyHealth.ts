/**
 * Soft dependency status strings reported by /readyz and /health.
 * These never fail the overall readiness probe on their own — they are for
 * operator visibility (dashboard can be up while map/PDR are offline).
 */

export type IndoorMapHealth =
  | "ok"
  | "unreachable"
  | "bundled"
  | "unavailable";

export type PdrProxyHealth = "disabled" | "ok" | "unreachable";

/** Indoor-map mode for health: Mode B proxy vs Mode A bundled assets vs neither. */
export function indoorMapHealthStatus(opts: {
  upstream: string;
  upstreamReachable: boolean | null;
  bundledTilesPresent: boolean;
}): IndoorMapHealth {
  if (opts.upstream) {
    return opts.upstreamReachable ? "ok" : "unreachable";
  }
  return opts.bundledTilesPresent ? "bundled" : "unavailable";
}

export function pdrProxyHealthStatus(opts: {
  origin: string;
  reachable: boolean | null;
}): PdrProxyHealth {
  if (!opts.origin) return "disabled";
  return opts.reachable ? "ok" : "unreachable";
}
