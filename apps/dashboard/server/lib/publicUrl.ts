import fs from "fs";
import path from "path";
import type { Request } from "express";
import { PUBLIC_BASE_URL } from "../config";

const DEFAULT_TUNNEL_URL_FILE = "/tmp/orienta_pax_tunnel/public_url.txt";

export function parseOrigin(raw: string): string {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function isLoopbackHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
}

export function isPrivateLanHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const parts = h.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Tailscale / CGNAT: 100.64.0.0/10 — the operator's own mesh, same trust as LAN. */
export function isTailscaleHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const parts = h.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a === 100 && b >= 64 && b <= 127;
}

function isEphemeralTunnel(origin: string): boolean {
  try {
    return new URL(origin).hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

function readTunnelFileOrigin(): string {
  const file = process.env.ORIENTA_TUNNEL_URL_FILE || DEFAULT_TUNNEL_URL_FILE;
  try {
    return parseOrigin(fs.readFileSync(file, "utf8"));
  } catch {
    return "";
  }
}

/** Re-read apps/dashboard/.env so a tunnel script can update PUBLIC_BASE_URL without a restart. */
function readDotenvPublicBase(): string {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      if (t.slice(0, eq).trim() !== "PUBLIC_BASE_URL") continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return parseOrigin(val);
    }
  } catch {
    /* no .env or unreadable */
  }
  return "";
}

function originFromHeaders(req: Request): string {
  const proto = (
    String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0] ?? "https"
  ).trim();
  const host = (
    String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0] ??
    "localhost"
  ).trim();
  return `${proto}://${host}`;
}

/**
 * The operator page they issued from (LAN / localhost / tunnel). Rejects a
 * forged Origin pointing at an unrelated public site.
 */
export function isAllowedOperatorOrigin(origin: string, req?: Request): boolean {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  const host = new URL(parsed).hostname;
  if (
    isLoopbackHostname(host) ||
    isPrivateLanHostname(host) ||
    isTailscaleHostname(host) ||
    isEphemeralTunnel(parsed)
  ) {
    return true;
  }
  if (PUBLIC_BASE_URL && parsed === PUBLIC_BASE_URL) return true;
  const live = readTunnelFileOrigin();
  if (live && parsed === live) return true;
  if (req && parsed === originFromHeaders(req)) return true;
  return false;
}

function pageOriginFromRequest(req: Request): string {
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const raw = String(
    body.pageOrigin || req.headers["x-orienta-page-origin"] || req.headers.origin || "",
  ).trim();
  const origin = parseOrigin(raw);
  return origin && isAllowedOperatorOrigin(origin, req) ? origin : "";
}

function configuredFallback(): string {
  const fromBoot = PUBLIC_BASE_URL;
  if (fromBoot && !isEphemeralTunnel(fromBoot)) return fromBoot;

  const liveTunnel = readTunnelFileOrigin();
  if (liveTunnel) return liveTunnel;

  if (fromBoot) {
    const fromFile = readDotenvPublicBase();
    if (fromFile) return fromFile;
    return fromBoot;
  }
  return "";
}

/**
 * Origin baked into invite email / SMS / QR.
 *
 * Uses the operator page they clicked Send on (`X-Orienta-Page-Origin` /
 * `Origin`). That is how a send from http://192.168.0.23:5173 produces a
 * claim link on that same host so the passenger talks back to this machine.
 * PUBLIC_BASE_URL / the trycloudflare sidecar are fallbacks when the page
 * origin is missing (scripts, no header).
 */
export function publicOrigin(req: Request): string {
  return pageOriginFromRequest(req) || configuredFallback() || originFromHeaders(req);
}
