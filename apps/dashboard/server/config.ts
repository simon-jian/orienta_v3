/**
 * Server configuration — reads, validates, and exports all env vars.
 *
 * Fixes issue M1: no central config validation; missing vars fail silently at runtime.
 * Solution: crash-fast at startup with a clear message if a required var is missing.
 *
 * Fixes issue L3: chaotic env variable naming — canonical names are VITE_*.
 * Legacy aliases are read as fallbacks with deprecation warnings.
 */

function required(name: string, ...aliases: string[]): string {
  const value = [name, ...aliases].map((k) => process.env[k]?.trim()).find(Boolean);
  if (!value) {
    throw new Error(
      `[orienta] Missing required env var: ${name}${aliases.length ? ` (also checked: ${aliases.join(", ")})` : ""}.\n` +
      `  Copy .env.example to .env and fill in the value.`
    );
  }
  return value;
}

function optional(name: string, ...aliases: string[]): string {
  const value = [name, ...aliases].map((k) => process.env[k]?.trim()).find(Boolean);
  if (aliases.length) {
    // Warn if a deprecated alias is being used instead of the canonical name
    for (const alias of aliases) {
      if (process.env[alias] && !process.env[name]) {
        console.warn(`[orienta] Deprecated env var "${alias}" — rename to "${name}" in your .env.`);
      }
    }
  }
  return value ?? "";
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * Normalise PDR_API_ORIGIN: strip a trailing /api suffix that breaks the proxy.
 * Previously this was done ad-hoc in server.ts with a console.warn.
 * Now it's handled centrally and documented.
 */
function normalizePdrOrigin(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (/\/api$/i.test(u)) {
    u = u.replace(/\/api$/i, "").replace(/\/+$/, "");
    console.warn(
      `[orienta] PDR_API_ORIGIN had a trailing /api — use the service root only. Normalized to: ${u}`
    );
  }
  return u;
}

// ─── Validate and export ──────────────────────────────────────────────────────

// Auth — required at startup
export const JWT_SECRET = required("JWT_SECRET");
/** "email:password,email2:password2" */
export const ADMIN_CREDENTIALS = required("ADMIN_CREDENTIALS");

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

// FlightAware — optional; API routes fall back to static data when missing
export const FLIGHTAWARE_API_KEY = optional("FLIGHTAWARE_API_KEY", "VITE_FLIGHTAWARE_API_KEY");

// VAPID for Web Push — optional; push routes return 503 when missing
export const VAPID_PUBLIC_KEY = optional("VAPID_PUBLIC_KEY");
export const VAPID_PRIVATE_KEY = optional("VAPID_PRIVATE_KEY");
export const VAPID_SUBJECT = optional("VAPID_SUBJECT") || "mailto:ops@orienta.ai";

// Temporary local premium account store for the first production-session slice.
// Format: email:password,email2:password2. Replace with a real account table before deployment.
export const PAX_ACCOUNT_CREDENTIALS = optional("PAX_ACCOUNT_CREDENTIALS");

// PDR proxy — optional
const rawPdrOrigin = optional("PDR_API_ORIGIN");
export const PDR_API_ORIGIN = rawPdrOrigin ? normalizePdrOrigin(rawPdrOrigin) : "";

// Indoor map — browser uses relative /indoor-map paths. Per README "Indoor
// map topology": empty means Mode A (bundled tiles/POI from public/, no
// external map stack needed); setting these means Mode B (proxy to a running
// map server). Deliberately no localhost fallback here — defaulting to
// "http://127.0.0.1:7801" would silently force Mode B (and fail every
// indoor-map request with a connection error) for anyone who leaves these
// unset expecting the documented bundled default, in dev or production.
export const INDOOR_MAP_UPSTREAM = optional("INDOOR_MAP_UPSTREAM");
export const INDOOR_MAP_API_UPSTREAM = optional("INDOOR_MAP_API_UPSTREAM");
export const VITE_LOCAL_AIRPORT_MAP = optional("VITE_LOCAL_AIRPORT_MAP") === "1";

// Frontend public vars (passed through to Vite, already prefixed VITE_)
export const VITE_INDOOR_MAP_URL = optional("VITE_INDOOR_MAP_URL", "VITE_ROUTE_SITE_INDOOR_MAP_URL") || "/indoor-map/airport-map.html";
export const VITE_INDOOR_MAP_API_BASE = optional("VITE_INDOOR_MAP_API_BASE", "VITE_ROUTE_SITE_INDOOR_MAP_API_BASE") || "/indoor-map-api";
export const VITE_INDOOR_MAP_TILE_URL = optional("VITE_INDOOR_MAP_TILE_URL", "VITE_ROUTE_SITE_INDOOR_TILE_URL");
export const VITE_INDOOR_MAP_SAME_ORIGIN = optional("VITE_INDOOR_MAP_SAME_ORIGIN", "VITE_ROUTE_SITE_INDOOR_MAP_SAME_ORIGIN") === "1";

// Server
export const PORT = optionalInt("PORT", 5174);

/** Default airport terminal for POI lookups (Multi-airport Phase 1). Defaults to PEK's T3E. */
export const DEFAULT_TERMINAL = optional("DEFAULT_TERMINAL") || "T3E";
export const ROUTE_SITE_DEFAULT_TENANT = optional("ROUTE_SITE_DEFAULT_TENANT") || "airchina";

/**
 * Origins allowed to call the tourist-position CORS routes.
 * - empty  → same-origin only (no ACAO header emitted)
 * - "*"    → open (kiosk/demo only)
 * - csv    → reflect the request Origin when it matches the allowlist
 */
export const TOURIST_ALLOWED_ORIGINS: string[] = optional("TOURIST_ALLOWED_ORIGINS")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Passenger registry database path (SQLite — used when DATABASE_URL is unset)
export const DB_PATH = optional("DB_PATH") || "./data/passengers.db";

// ─── Multi-instance backends (P2-1 / P2-3) ────────────────────────────────────
// When set, the server uses Postgres for persistence and Redis for shared
// rate-limit / presence / WS fan-out. When unset, it falls back to single-machine
// SQLite + in-memory (the default for local dev).
export const DATABASE_URL = optional("DATABASE_URL");
export const REDIS_URL = optional("REDIS_URL");

/** Persistence dialect: "pg" when DATABASE_URL is set, else "sqlite". */
export const DB_DIALECT: "pg" | "sqlite" = DATABASE_URL ? "pg" : "sqlite";

/** Whether shared Redis coordination is enabled (multi-instance). */
export const REDIS_ENABLED = !!REDIS_URL;

/** Optional instance id for logs / WS fan-out de-dup. */
export const INSTANCE_ID = optional("INSTANCE_ID") || `inst_${Math.random().toString(16).slice(2, 8)}`;

// ─── Error tracking (P2-5) ────────────────────────────────────────────────────
// Optional Sentry integration. When SENTRY_DSN is unset, error tracking is a
// no-op (errors are still logged via the structured logger) so local/offline
// dev needs no external service. VITE_SENTRY_DSN wires the browser SDK.
export const SENTRY_DSN = optional("SENTRY_DSN");
export const SENTRY_ENVIRONMENT = optional("SENTRY_ENVIRONMENT") || process.env.NODE_ENV || "development";
export const SENTRY_RELEASE = optional("SENTRY_RELEASE");
/** Performance trace sampling 0..1. Default 0 = errors only, no perf overhead. */
export const SENTRY_TRACES_SAMPLE_RATE = (() => {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
})();

// ─── Video merge job service (P2-4) ───────────────────────────────────────────
// When DATABASE_URL/REDIS_URL drive multi-instance, the CPU-heavy PEK video merge
// is offloaded to a separate worker (scripts/pek_video_worker.py) via a Redis
// queue. These let the web + worker agree on the shared output/source dirs.
// Empty → use the in-repo route_site paths (single-machine default).
export const VIDEO_OUTPUT_DIR = optional("VIDEO_OUTPUT_DIR");
export const VIDEO_SOURCE_DIR = optional("VIDEO_SOURCE_DIR");

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * Optional per-admin overrides, kept in separate env vars (rather than packed
 * into ADMIN_CREDENTIALS with more colon-separated fields) so an existing
 * "email:password" entry — including a dev-only plaintext password that
 * happens to contain a colon — never becomes ambiguous to parse.
 *
 * Format for both: "email1=value1,email2=value2". ADMIN_TENANT_SCOPES' value
 * is itself a "|"-separated list of tenant ids (e.g. "airchina|united").
 * An email with no entry keeps the old behavior (role inferred from the
 * "ops"-prefix heuristic; unrestricted to every tenant) — fully backward
 * compatible with existing single-tenant deployments.
 */
function parseEmailKeyedMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const email = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    if (email && value) map.set(email, value);
  }
  return map;
}

const ADMIN_ROLE_OVERRIDES = optional("ADMIN_ROLES");
const ADMIN_TENANT_SCOPES = optional("ADMIN_TENANT_SCOPES");

/** Parse ADMIN_CREDENTIALS into a lookup map. */
export function getAdminCredentials(): Map<
  string,
  { password: string; role: "admin" | "ops" | "viewer"; displayName: string; org: string; tenants: string[] | null }
> {
  const map = new Map<
    string,
    { password: string; role: "admin" | "ops" | "viewer"; displayName: string; org: string; tenants: string[] | null }
  >();
  const roleOverrides = parseEmailKeyedMap(ADMIN_ROLE_OVERRIDES);
  const tenantScopes = parseEmailKeyedMap(ADMIN_TENANT_SCOPES);

  for (const pair of ADMIN_CREDENTIALS.split(",")) {
    const [email, ...rest] = pair.trim().split(":");
    const password = rest.join(":").trim(); // allow colons in passwords
    if (!email || !password) continue;

    const e = email.trim().toLowerCase();
    const overriddenRole = roleOverrides.get(e);
    const role: "admin" | "ops" | "viewer" =
      overriddenRole === "admin" || overriddenRole === "ops" || overriddenRole === "viewer"
        ? overriddenRole
        : e.startsWith("ops")
          ? "ops"
          : "admin";
    const displayName = role === "ops" ? "国航运行席位" : "国航管理员";
    const org = "Air China";
    // null = unrestricted (every tenant) — the default when ADMIN_TENANT_SCOPES
    // doesn't mention this email, matching pre-existing single-tenant deploys.
    const scopeRaw = tenantScopes.get(e);
    const tenants = scopeRaw ? scopeRaw.split("|").map((t) => t.trim()).filter(Boolean) : null;
    map.set(e, { password, role, displayName, org, tenants });
  }

  return map;
}

/** Check if VAPID push is configured. */
export function isPushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

// ─── Kiosk scan gating ────────────────────────────────────────────────────────
// Optional shared secret required from boarding-pass scan kiosks before
// POST /api/pax/scan will mint a session. Unset → endpoint stays open (dev
// convenience), but validateProductionSecurity() refuses to boot with it unset
// in production.
export const KIOSK_SCAN_SECRET = optional("KIOSK_SCAN_SECRET");

// ─── Production security gate ─────────────────────────────────────────────────
// Fixes issue: required() only checks presence, not strength — a one-character
// JWT_SECRET or a plaintext admin password would boot happily. Called once from
// server.ts before the server starts listening; no-ops outside production so
// local dev and tests (NODE_ENV=test) are unaffected.
const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRETS = new Set([
  "your_jwt_secret_here",
  "replace-with-openssl-rand-hex-32",
  "changeme",
  "secret",
  "test-secret",
]);

export function validateProductionSecurity(): void {
  if (!IS_PRODUCTION) return;
  const problems: string[] = [];

  if (JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (got ${JWT_SECRET.length}). Generate one with: openssl rand -hex 32`);
  }
  if (PLACEHOLDER_SECRETS.has(JWT_SECRET.trim().toLowerCase())) {
    problems.push("JWT_SECRET is a known placeholder value — replace it with a real secret.");
  }

  for (const [email, cred] of getAdminCredentials()) {
    if (!cred.password.startsWith("scrypt$")) {
      problems.push(`ADMIN_CREDENTIALS for "${email}" is not scrypt-hashed. Generate one with: node dist-server/server/scripts/hashAdminPassword.js '<password>'`);
    }
  }

  if (!KIOSK_SCAN_SECRET) {
    problems.push("KIOSK_SCAN_SECRET is unset — POST /api/pax/scan will accept boarding-pass scans from anyone, not just trusted kiosks. Set it (and configure kiosks to send it) before go-live.");
  }

  // docker-compose.yml's bundled Postgres defaults to this password when
  // POSTGRES_PASSWORD is unset (Compose interpolates every service's env vars
  // up front, so that default can't be made `required` without also breaking
  // deploys that don't use --profile scale at all). Catch it here instead.
  if (DATABASE_URL && /:\/\/[^:]+:orienta@/.test(DATABASE_URL)) {
    problems.push('DATABASE_URL uses the docker-compose.yml example password ("orienta") — set POSTGRES_PASSWORD to a strong value and update DATABASE_URL to match.');
  }

  if (problems.length > 0) {
    throw new Error(
      "[orienta] Refusing to start in production with insecure config:\n" +
      problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}
