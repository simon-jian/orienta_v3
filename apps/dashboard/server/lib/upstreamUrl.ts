/**
 * Helpers for validating upstream service URLs (PDR, indoor map) in production.
 */

/** True when the URL host is loopback (container-local, not the Docker host). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

export function isLoopbackHttpUrl(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    return isLoopbackHostname(new URL(raw).hostname);
  } catch {
    return false;
  }
}
