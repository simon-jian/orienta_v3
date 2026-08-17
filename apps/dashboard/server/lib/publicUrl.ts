import type { Request } from "express";
import { PUBLIC_BASE_URL } from "../config";

/**
 * Origin to use when building a link that leaves the system (emailed, texted,
 * shown as a QR code).
 *
 * Prefers the configured `PUBLIC_BASE_URL`; the request headers are only a
 * development fallback. See that config entry for why the headers can't be
 * trusted on their own.
 */
export function publicOrigin(req: Request): string {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = (String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0] ?? "https").trim();
  const host = (String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0] ?? "localhost").trim();
  return `${proto}://${host}`;
}
