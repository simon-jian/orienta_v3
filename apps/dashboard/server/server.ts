/**
 * Production server entry point.
 *
 * Wires: config → paths → HubStore → routes → WS hub → listen.
 *
 * Key improvements over v2 server.ts:
 *   - All env vars validated at startup (config.ts)
 *   - All paths in one place (paths.ts)
 *   - HubStore injected into both routes and hub (no singletons)
 *   - Server-side JWT auth (routes/auth.ts)
 */
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
// Must import right after express, before any router/route is defined: patches
// express.Router methods so a rejected promise in an async handler reaches the
// error middleware (expressErrorHandler below) instead of hanging the request.
// Express 5 does this natively; this app is still on Express 4.
import "express-async-errors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createProxyMiddleware } from "http-proxy-middleware";

import { PORT, PDR_API_ORIGIN, INDOOR_MAP_UPSTREAM, INDOOR_MAP_API_UPSTREAM, VITE_LOCAL_AIRPORT_MAP, validateProductionSecurity } from "./config";
import { pdrProxyAllowlist, isAllowedPdrUpgradePath } from "./middleware/pdrProxyGuard";
import { injectPdrUiEmbedBridge } from "./pdrUiEmbed";

// Fail fast, before anything else initializes, if production config is insecure
// (weak/placeholder JWT_SECRET, plaintext admin passwords, kiosk scan wide open).
validateProductionSecurity();
import {
  DIST_DIR, REPO_AIRPORT_MAP_PATH,
  LOCAL_INDOOR_MAP_API_DIR, LOCAL_INDOOR_MAP_TILES_DIR,
} from "./paths";
import { HubStore, attachWsHub } from "./hub/wsHub";
import { ChatRepository } from "./hub/ChatRepository";
import { registerAuthRoutes } from "./routes/auth";
import { registerFlightRoutes, registerLegacyFlightFallback, registerOrientaRoutes } from "./routes/flight";
import { registerWeatherRoutes } from "./routes/weather";
import { registerFidsRoutes } from "./routes/fids";
import { registerPushRoutes } from "./routes/push";
import {
  registerAdminVoiceNoteRoute,
  registerPaxVoiceNoteRoute,
  registerVoiceNoteGetRoute,
} from "./routes/voiceNotes";
import { registerPassengerRoutes } from "./routes/passengers";
import { registerPaxSessionRoutes } from "./routes/paxSessions";
import { registerPaxInviteRoutes } from "./routes/paxInvites";
import { registerJourneyRoutes } from "./routes/journey";
import { PassengerRegistry } from "./passengers/PassengerRegistry";
import { PaxAccountStore } from "./passengers/PaxAccountStore";
import { PaxInviteStore } from "./passengers/PaxInviteStore";
import { PushSubscriptionStore } from "./passengers/PushSubscriptionStore";
import { JourneyStore } from "./journey/JourneyStore";
import { AuditLog } from "./lib/auditLog";
import { startMaintenanceJobs } from "./jobs/maintenance";
import { createRateLimiter, paxIdentityKey } from "./middleware/rateLimit";
import { requestLog } from "./middleware/requestLog";
import { logger } from "./lib/logger";
import { indoorMapHealthStatus, pdrProxyHealthStatus } from "./lib/dependencyHealth";
import { countTelemetryRateLimited, telemetryStatsSnapshot } from "./lib/telemetryStats";
// #region agent log
import { debugLog } from "./lib/debugLog";
// #endregion
import { MetricsRepository } from "./lib/MetricsRepository";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerConfigRoutes } from "./routes/config";
import { hydrateRegistriesFromDisk } from "./config/loadConfig";
import { ROUTE_SITE_DEFAULT_TENANT } from "./config";
import { getSqlDb } from "./db/sqlDb";
import { runMigrations } from "./db/migrations";
import { migrations } from "./db/migrationList";
import { getRedisCmd, createRedisConnection } from "./redis/redisClient";
import { MemoryHubBus, RedisHubBus, type HubBus } from "./hub/HubBus";
import { REDIS_ENABLED, INSTANCE_ID } from "./config";
import {
  applyAirportMapNoCacheHeaders,
  applyIframeSafeHtmlHeaders,
  fetchUpstreamAirportMapHtml,
  isBrowserRequestHttps,
  prepareIndoorMapProxyResponse,
  rewriteLocationHeaderToBrowserProxyPrefix,
  transformAirportMapHtmlFromSource,
} from "./indoorMapProxyUtils";
import { loadPoiCache } from "./lib/poiCache";
import { initErrorTracking, expressErrorHandler, flushErrorTracking, captureException } from "./lib/errorTracking";

// ─── Error tracking (P2-5) ───────────────────────────────────────────────────
// Boot Sentry + process-level guards as early as possible so failures during
// the rest of startup are captured. No-op when SENTRY_DSN is unset.
initErrorTracking();

// ─── Shared hub store + persistence services ─────────────────────────────────
// SqlDb is Postgres when DATABASE_URL is set, else SQLite (P2-1).
const sqlDb = getSqlDb();
const chatRepo = new ChatRepository(sqlDb);
const store = new HubStore(chatRepo);

// ─── Cross-instance coordination (P2-3) ──────────────────────────────────────
// Redis enables shared presence + WS fan-out + rate limiting across instances.
// Without REDIS_URL these are no-ops and the server runs single-instance.
const redisCmd = getRedisCmd();
const hubBus: HubBus = REDIS_ENABLED
  ? new RedisHubBus(
      createRedisConnection("hub-pub")!,
      createRedisConnection("hub-sub")!,
      (env) => store.deliverRemote(env),
    )
  : new MemoryHubBus();
store.attachCluster({ bus: hubBus, redis: redisCmd });
const accountStore = new PaxAccountStore(sqlDb);
const auditLog = new AuditLog(sqlDb);
const metricsRepo = new MetricsRepository(sqlDb);
const pushSubStore = new PushSubscriptionStore(sqlDb);

// ─── Passenger registry ───────────────────────────────────────────────────────
const registry = new PassengerRegistry(sqlDb);
const journeyStore = new JourneyStore(sqlDb);
const paxInviteStore = new PaxInviteStore(sqlDb);

const authRateLimit = createRateLimiter({
  name: "auth", windowMs: 60_000, maxRequests: 20, redis: redisCmd, failClosed: true,
});
// Keyed per session rather than per IP: an airport's WiFi or a carrier NAT puts
// many passengers behind one address, where a per-IP bucket makes them throttle
// each other (see paxIdentityKey).
const paxRateLimit = createRateLimiter({
  name: "pax", windowMs: 60_000, maxRequests: 60, redis: redisCmd, keyFn: paxIdentityKey,
});
// Position telemetry gets its own budget. It used to share the bucket above with
// chat polling and presence, so a walking passenger exhausted it in seconds and
// their position silently stopped reaching the operator map. Positions normally
// travel over the pax WebSocket now; this covers the HTTP fallback plus
// standalone clients (route_site, kiosks).
const touristTelemetryRateLimit = createRateLimiter({
  name: "tourist-telemetry", windowMs: 60_000, maxRequests: 180, redis: redisCmd,
  keyFn: paxIdentityKey, onLimited: countTelemetryRateLimited,
});
// Coarse outer cap, still per IP: paxIdentityKey mints a bucket per token, so
// without this a single host could spray bogus tokens for unlimited budget.
const paxIpRateLimit = createRateLimiter({ name: "pax-ip", windowMs: 60_000, maxRequests: 600, redis: redisCmd });
const paxBasicRateLimit = createRateLimiter({ name: "pax-basic", windowMs: 60_000, maxRequests: 10, redis: redisCmd });
const paxScanRateLimit = createRateLimiter({ name: "pax-scan", windowMs: 60_000, maxRequests: 20, redis: redisCmd });
const paxBoardingPassRateLimit = createRateLimiter({
  name: "pax-boarding-pass", windowMs: 60_000, maxRequests: 8, redis: redisCmd, failClosed: true,
});
const paxLoginRateLimit = createRateLimiter({
  name: "pax-login", windowMs: 60_000, maxRequests: 10, redis: redisCmd, failClosed: true,
});
// Redeeming an invite is a bearer-secret check, so it is brute-forceable in
// principle — fail closed and keep the cap low. Legitimate use is one call per
// passenger per device, with a retry or two after a network blip.
const paxInviteRedeemRateLimit = createRateLimiter({
  name: "pax-invite-redeem", windowMs: 60_000, maxRequests: 10, redis: redisCmd, failClosed: true,
});
// Twilio is billed per send; keep the operator-facing button from being a
// spray hose if a session is left open on a shared desk.
const paxInviteSmsRateLimit = createRateLimiter({
  name: "pax-invite-sms", windowMs: 60_000, maxRequests: 8, redis: redisCmd, failClosed: true,
});
const paxInviteEmailRateLimit = createRateLimiter({
  name: "pax-invite-email", windowMs: 60_000, maxRequests: 8, redis: redisCmd, failClosed: true,
});
// GET /api/flight/closest and POST /api/transfer call FlightAware directly on
// every request (no FIDS cache) — cap per IP to protect the AeroAPI quota.
const aeroApiRateLimit = createRateLimiter({ name: "aeroapi", windowMs: 60_000, maxRequests: 30, redis: redisCmd });
const metricsRateLimit = createRateLimiter({ name: "metrics", windowMs: 60_000, maxRequests: 120, redis: redisCmd });
const pdrProxyRateLimit = createRateLimiter({ name: "pdr-proxy", windowMs: 60_000, maxRequests: 60, redis: redisCmd });

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
// Behind a reverse proxy (TLS terminator): trust the first hop for req.ip / proto (P1-10).
app.set("trust proxy", 1);
// Security headers.
//
// frameguard/COOP/CORP are enabled with same-origin settings: every iframe use
// in this app (the indoor-map proxy) is same-origin, so this only blocks
// cross-origin framing/embedding, not the app's own documented usage.
//
// contentSecurityPolicy stays off deliberately, not by oversight: the
// dashboard's Leaflet map pulls tiles from {s}.tile.openstreetmap.org, FIDS
// renders airline logos from images.kiwi.com, and Sentry (when configured)
// needs a connect-src to its ingest endpoint. A correct policy needs those
// enumerated and verified in a running browser before shipping — an
// unverified policy here would silently break features rather than add
// safety. crossOriginEmbedderPolicy stays off for the same reason.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  frameguard: { action: "sameorigin" },
}));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  res.setHeader("Feature-Policy", "camera 'self'; microphone 'self'");
  next();
});
app.use(requestLog);
app.use(cookieParser());

// #region agent log
// TEMPORARY debug relay: phones on the dev tunnel cannot reach the debug log
// sink on this machine, so browser-side instrumentation posts here instead.
app.post("/api/debug-log", express.json({ limit: "32kb" }), (req, res) => {
  debugLog({ ...(req.body || {}) });
  res.status(204).end();
});
// #endregion

// ─── Upstream proxies BEFORE body parsers ─────────────────────────────────────
// express.json / express.text consume the request stream. If they run first,
// http-proxy-middleware forwards an empty body to PDR (POST /api/session loses
// planned_path). Keep all reverse-proxy mounts above the parsers.
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7m9JwAAAABJRU5ErkJggg==",
  "base64"
);

let pdrProxy: ReturnType<typeof createProxyMiddleware> | null = null;
if (PDR_API_ORIGIN) {
  pdrProxy = createProxyMiddleware({
    target: PDR_API_ORIGIN,
    changeOrigin: true,
    // WebSocket upgrades are dispatched by this file's own `server.on("upgrade")`
    // below, so the path allowlist applies to them.
    //
    // `ws: true` cannot be used for that: the library then registers its own
    // upgrade listener on the HTTP server whose default path filter is "/",
    // which matches every path. It therefore also answered the app's own /ws
    // handshakes, and that second 101 response on a socket the hub had already
    // upgraded looked like a corrupt frame to the browser ("RSV1 must be
    // clear") — every passenger WebSocket died ~100ms after opening, so live
    // positions and chat fell back to HTTP polling. It bypassed the allowlist
    // for /pdr-api upgrades too.
    ws: false,
    // Belt and braces: consulted by the manual dispatch below as well, so a PDR
    // upgrade for a path outside the allowlist can never be proxied.
    pathFilter: (pathname: string, req: unknown) => {
      const upgrade = String((req as http.IncomingMessage).headers?.upgrade || "").toLowerCase();
      return upgrade !== "websocket" || isAllowedPdrUpgradePath(pathname);
    },
    pathRewrite: { "^/pdr-api": "" },
    on: {
      // PDR has no CORS layer and guards its WS handshake by comparing Origin
      // against its own Host, so a browser Origin of this dashboard's public
      // URL is rejected — and that URL changes with every dev tunnel. Present
      // the target's own origin instead: PDR is only reachable through this
      // proxy, whose upgrade path allowlist is the real gate (see below).
      proxyReqWs: (proxyReq) => proxyReq.setHeader("origin", PDR_API_ORIGIN),
    },
  });
  app.use("/pdr-api", pdrProxyRateLimit, pdrProxyAllowlist(), pdrProxy);
  logger.info("pdr_api_proxy", { target: PDR_API_ORIGIN, allowlist: true });

  // Full PDR frontend (pdr.html + js/*) for passenger embed — not allowlisted API-only.
  app.get(["/pdr-ui", "/pdr-ui/", "/pdr-ui/index.html", "/pdr-ui/pdr.html"], async (req, res, next) => {
    try {
      const rawPath = (req.path || "").replace(/^\/pdr-ui/, "") || "/";
      const targetPath = rawPath === "/" ? "/index.html" : rawPath;
      const qs = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const upstream = `${PDR_API_ORIGIN.replace(/\/+$/, "")}${targetPath}${qs}`;
      // #region agent log
      {
        const forwarded = new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
        debugLog({
          runId: "post-fix", hypothesisId: "A",
          location: "server/server.ts:190", message: "pdr-ui html fetched from upstream",
          data: {
            targetPath,
            forwardedParams: [...forwarded.keys()],
            forwardsSessionToken: forwarded.has("sessionToken"),
          },
        });
      }
      // #endregion
      const r = await fetch(upstream);
      let html = await r.text();
      html = injectPdrUiEmbedBridge(html);
      res.status(r.status);
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.send(html);
    } catch (e) {
      next(e);
    }
  });
  app.use(
    "/pdr-ui",
    createProxyMiddleware({
      target: PDR_API_ORIGIN,
      changeOrigin: true,
      pathRewrite: { "^/pdr-ui": "" },
    }),
  );
  logger.info("pdr_ui_proxy", { target: PDR_API_ORIGIN, mount: "/pdr-ui" });
} else {
  app.use("/pdr-api", (_req, res) => res.status(503).json({ error: "pdr_proxy_disabled", message: "Set PDR_API_ORIGIN env var to enable." }));
  app.use("/pdr-ui", (_req, res) => res.status(503).send("PDR UI disabled — set PDR_API_ORIGIN"));
}

if (INDOOR_MAP_UPSTREAM || VITE_LOCAL_AIRPORT_MAP) {
  app.head("/indoor-map/airport-map.html", async (req, res, next) => {
    try {
      const https = isBrowserRequestHttps(req);
      if (VITE_LOCAL_AIRPORT_MAP) {
        res.status(200);
        applyIframeSafeHtmlHeaders(res, https);
        applyAirportMapNoCacheHeaders(res);
        res.end();
        return;
      }
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const r = await fetch(`${INDOOR_MAP_UPSTREAM.replace(/\/+$/, "")}/airport-map.html${qs}`, { method: "HEAD" });
      res.status(r.status);
      applyIframeSafeHtmlHeaders(res, https);
      applyAirportMapNoCacheHeaders(res);
      res.end();
    } catch (e) { next(e); }
  });

  app.get("/indoor-map/airport-map.html", async (req, res, next) => {
    try {
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const https = isBrowserRequestHttps(req);
      if (VITE_LOCAL_AIRPORT_MAP) {
        const html = transformAirportMapHtmlFromSource(readFileSync(REPO_AIRPORT_MAP_PATH, "utf8"), {
          mapRole: typeof req.query.mapRole === "string" ? req.query.mapRole : undefined,
        });
        res.status(200);
        applyIframeSafeHtmlHeaders(res, https);
        applyAirportMapNoCacheHeaders(res);
        res.setHeader("Content-Type", "text/html; charset=utf-8")
          .setHeader("X-Orienta-Airport-Map", "local-repo")
          .send(html);
        return;
      }
      const { status, html, contentType } = await fetchUpstreamAirportMapHtml(
        INDOOR_MAP_UPSTREAM, qs, { fallbackHtmlPath: REPO_AIRPORT_MAP_PATH },
      );
      res.status(status);
      applyIframeSafeHtmlHeaders(res, https);
      applyAirportMapNoCacheHeaders(res);
      if (contentType) res.setHeader("Content-Type", contentType);
      res.setHeader("X-Orienta-Airport-Map", "upstream+inject").send(html);
    } catch (e) { next(e); }
  });
}

if (INDOOR_MAP_UPSTREAM) {
  const indoorMapProxy = createProxyMiddleware({
    target: INDOOR_MAP_UPSTREAM, changeOrigin: true,
    pathRewrite: { "^/indoor-map": "" },
    on: {
      proxyRes(proxyRes, req) {
        rewriteLocationHeaderToBrowserProxyPrefix(proxyRes, INDOOR_MAP_UPSTREAM, "/indoor-map");
        const ct = String(proxyRes.headers["content-type"] || "").toLowerCase();
        prepareIndoorMapProxyResponse(proxyRes.headers, ct.includes("text/html"), isBrowserRequestHttps(req));
      },
    },
  });
  app.use("/indoor-map", indoorMapProxy);
  logger.info("indoor_map_proxy", { target: INDOOR_MAP_UPSTREAM });
} else if (existsSync(LOCAL_INDOOR_MAP_TILES_DIR)) {
  app.get("/indoor-map/tile/:z/:x/:y.png", (req, res) => {
    const { z, x, y } = req.params;
    if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return res.status(400).type("text/plain").send("Bad tile path");
    }
    const p = `${LOCAL_INDOOR_MAP_TILES_DIR}/${z}/${x}/${y}.png`;
    res.setHeader("Content-Type", "image/png")
      .setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return existsSync(p) ? res.sendFile(p) : res.status(200).send(transparentPng);
  });
  app.head("/indoor-map/tile/:z/:x/:y.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png").status(200).end();
  });
  logger.info("indoor_map_tiles_bundled", { dir: LOCAL_INDOOR_MAP_TILES_DIR });
}

if (INDOOR_MAP_API_UPSTREAM) {
  const indoorMapApiProxy = createProxyMiddleware({
    target: INDOOR_MAP_API_UPSTREAM, changeOrigin: true,
    pathRewrite: { "^/indoor-map-api": "" },
    on: { proxyRes(proxyRes) { rewriteLocationHeaderToBrowserProxyPrefix(proxyRes, INDOOR_MAP_API_UPSTREAM, "/indoor-map-api"); } },
  });
  app.use("/indoor-map-api", indoorMapApiProxy);
  logger.info("indoor_map_api_proxy", { target: INDOOR_MAP_API_UPSTREAM });
} else if (existsSync(`${LOCAL_INDOOR_MAP_API_DIR}/poi.json`)) {
  interface GeoFeatureCollection {
    type: string;
    features: Array<{ properties?: Record<string, unknown> }>;
  }
  const loadFC = (name: string): GeoFeatureCollection => {
    const p = `${LOCAL_INDOOR_MAP_API_DIR}/${name}`;
    if (!existsSync(p)) return { type: "FeatureCollection", features: [] };
    return JSON.parse(readFileSync(p, "utf8")) as GeoFeatureCollection;
  };
  const filterFC = (col: GeoFeatureCollection, q: Record<string, unknown>): GeoFeatureCollection => {
    const entries = Object.entries(q)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v).trim()] as const);
    if (!entries.length) return col;
    return {
      ...col,
      features: col.features.filter((f) =>
        entries.every(([k, v]) => String(f?.properties?.[k] ?? "").trim() === v),
      ),
    };
  };
  app.get("/indoor-map-api/api/poi",    (req, res) => res.json(filterFC(loadFC("poi.json"),    req.query)));
  app.get("/indoor-map-api/api/zones",  (req, res) => res.json(filterFC(loadFC("zones.json"),  req.query)));
  app.get("/indoor-map-api/api/tracks", (_req, res) => res.json(loadFC("tracks.json")));
  app.get("/indoor-map-api/health", (_req, res) => {
    const poi = loadFC("poi.json"); const zones = loadFC("zones.json");
    res.json({ status: "ok", source: "bundled-static", poi_count: poi.features?.length ?? 0, zone_count: zones.features?.length ?? 0 });
  });
  logger.info("indoor_map_api_bundled", { dir: LOCAL_INDOOR_MAP_API_DIR });
}

// Body parsers AFTER proxies. Scope text parsing to metrics (sendBeacon).
app.use(express.json({ limit: "1mb" }));
app.use("/api/metrics", express.text({ type: ["text/plain", "text/*"], limit: "4kb" }));

// ─── Client metrics ingestion (P1-5) ──────────────────────────────────────────
const metricsRouter = express.Router();
registerMetricsRoutes(metricsRouter, metricsRepo);
app.use("/api/metrics", metricsRateLimit, metricsRouter);

// ─── Public tenant/airport config (P5 multi-airport) ──────────────────────────
const configRouter = express.Router();
registerConfigRoutes(configRouter);
app.use("/api/config", configRouter);

// ─── Auth routes ──────────────────────────────────────────────────────────────
const authRouter = express.Router();
registerAuthRoutes(authRouter, auditLog);
app.use("/api/auth", authRateLimit, authRouter);

// ─── Flight / airport routes ──────────────────────────────────────────────────
// Two separate router instances: the "/api" mount must NOT carry the legacy
// catch-all (see registerLegacyFlightFallback doc comment) because it would
// shadow other single-segment /api/* routes registered afterwards, such as
// GET /api/passengers.
const flightRouter = express.Router();
registerFlightRoutes(flightRouter, aeroApiRateLimit);
registerWeatherRoutes(flightRouter);
registerFidsRoutes(flightRouter, aeroApiRateLimit);
app.use("/api", flightRouter);

const legacyFlightRouter = express.Router();
registerFlightRoutes(legacyFlightRouter, aeroApiRateLimit);
registerLegacyFlightFallback(legacyFlightRouter);
app.use("/flight", legacyFlightRouter);

// ─── Orienta-specific routes ──────────────────────────────────────────────────
const orientaRouter = express.Router();
registerOrientaRoutes(orientaRouter);
app.use("/api/orienta", orientaRouter);

// ─── Push / presence / tourist routes ─────────────────────────────────────────
// Unprefixed paths external clients post to (route_site, kiosks, the PDR app's
// orienta bridge) rewritten onto the prefixed routes below, before the budget
// middleware so aliased telemetry is billed like any other. Mounting pushRouter
// on them directly cannot work: Express strips the entire mount path, leaving
// "/", which matches none of the router's own routes.
const TOURIST_ALIAS_PATHS = ["/api/tourist-position", "/api/tourist-deactivate"];
app.use((req, _res, next) => {
  if (TOURIST_ALIAS_PATHS.includes(req.path)) req.url = `/api/pax${req.url.slice("/api".length)}`;
  next();
});

/**
 * One HTTP budget for all passenger routes, charged once per request.
 *
 * Mounted at the prefixes rather than inside each router: /api/pax is served by
 * two routers, and a router-level limiter charges the bucket even for paths that
 * fall through to the next router — so anything pushRouter serves under /api/pax
 * (chat polling, presence, telemetry) was silently billed twice, halving those
 * budgets. Every prefix pushRouter is mounted at is listed here, so no route can
 * reach it unbilled.
 *
 * Position telemetry is split out because it is an order of magnitude more
 * frequent than the rest: sharing one bucket let a walking passenger starve
 * their own chat and presence within seconds.
 */
const PAX_HTTP_PREFIXES = ["/api/pax", "/api/push", "/api/orienta"];
const TELEMETRY_PATHS = new Set(["/tourist-position", "/tourist-deactivate"]);
app.use(PAX_HTTP_PREFIXES, paxIpRateLimit, (req, res, next) =>
  TELEMETRY_PATHS.has(req.path)
    ? touristTelemetryRateLimit(req, res, next)
    : paxRateLimit(req, res, next),
);

const paxSessionRouter = express.Router();
// Tighter caps on public mint / login paths (in addition to the shared budget).
paxSessionRouter.post("/basic-session", paxBasicRateLimit);
paxSessionRouter.post("/scan", paxScanRateLimit);
paxSessionRouter.post("/boarding-pass", paxBoardingPassRateLimit);
paxSessionRouter.post("/account-login", paxLoginRateLimit);
paxSessionRouter.post("/invites/redeem", paxInviteRedeemRateLimit);
paxSessionRouter.post("/invites/:id/sms", paxInviteSmsRateLimit);
paxSessionRouter.post("/invites/:id/email", paxInviteEmailRateLimit);
registerPaxSessionRoutes(paxSessionRouter, registry, accountStore, auditLog);
registerPaxInviteRoutes(paxSessionRouter, paxInviteStore, registry, auditLog, store, pushSubStore);
app.use("/api/pax", paxSessionRouter);

const journeyRouter = express.Router();
// Charged on this router's own paths, not router-wide: it is mounted at /api, so
// a router-level limiter billed the shared pax bucket for every /api/* request
// that merely passed through on its way to a later router — including the
// position telemetry that has its own budget above.
journeyRouter.use(["/flights", "/arrival"], paxRateLimit);
registerJourneyRoutes(journeyRouter, journeyStore, registry);
app.use("/api", journeyRouter);

const pushRouter = express.Router();
registerPushRoutes(pushRouter, store, pushSubStore, auditLog);
registerPaxVoiceNoteRoute(pushRouter, store, auditLog);
registerAdminVoiceNoteRoute(pushRouter, store, auditLog);
app.use("/api/push",               pushRouter);
app.use("/api/pax",                pushRouter);
app.use("/api/orienta",            pushRouter);  // /api/orienta/presence, /tourist-*

const voiceNoteGetRouter = express.Router();
registerVoiceNoteGetRoute(voiceNoteGetRouter);
app.use("/api/voice-notes", paxIpRateLimit, paxRateLimit, voiceNoteGetRouter);

// ─── Passenger management routes ──────────────────────────────────────────────
const passengerRouter = express.Router();
registerPassengerRoutes(passengerRouter, store, registry, auditLog, pushSubStore, paxInviteStore);
app.use("/api/passengers", passengerRouter);

// ─── Health probe (P0-8) ──────────────────────────────────────────────────────
// Process alive + DB ping are the only checks that flip the HTTP status: without
// a working database the app can't do anything useful. PDR/indoor-map are
// proxied, best-effort features — reported for visibility but never fail the
// probe (a dead upstream there degrades one feature, not the whole app).
// Redis, when configured, DOES flip the status: it backs cross-instance
// presence/rate-limit/WS fan-out, so "configured but unreachable" is a real
// problem for a multi-instance deploy, not a soft feature.
const SERVER_START_MS = Date.now();
const HEALTH_UPSTREAM_TIMEOUT_MS = 2000;

async function pingRedisHealth(): Promise<"disabled" | "ok" | "fail"> {
  if (!redisCmd) return "disabled";
  try {
    return (await redisCmd.ping()) === "PONG" ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

async function pingHttpUpstream(baseUrl: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      signal: AbortSignal.timeout(HEALTH_UPSTREAM_TIMEOUT_MS),
    });
    // Any response (including a 404 for a probe path the upstream doesn't
    // define) proves the upstream is reachable; only network failures count.
    return res.status > 0;
  } catch {
    return false;
  }
}

// Liveness: "is the Node process alive and responsive" — no dependency I/O at
// all. This is what should decide whether an orchestrator restarts the
// container: a slow/unreachable DB or Redis is not a reason to kill and
// restart an otherwise-healthy process (that just makes a transient outage
// worse by dropping every in-flight WS connection too), but a truly wedged
// event loop that can't even answer this cheap request is.
app.get("/livez", (_req, res) => {
  res.status(200).json({ status: "ok", uptime_s: Math.round((Date.now() - SERVER_START_MS) / 1000) });
});

async function readinessBody(): Promise<{ overallOk: boolean; body: Record<string, unknown> }> {
  const [dbOk, redisStatus, pdrReachable, indoorMapReachable] = await Promise.all([
    sqlDb.ping().catch(() => false),
    pingRedisHealth(),
    PDR_API_ORIGIN ? pingHttpUpstream(PDR_API_ORIGIN, "/health") : Promise.resolve(null),
    INDOOR_MAP_UPSTREAM ? pingHttpUpstream(INDOOR_MAP_UPSTREAM, "/") : Promise.resolve(null),
  ]);

  const redisOk = redisStatus !== "fail";
  const overallOk = dbOk && redisOk;
  return {
    overallOk,
    body: {
      status: overallOk ? "ok" : "degraded",
      uptime_s: Math.round((Date.now() - SERVER_START_MS) / 1000),
      checks: {
        process: "ok",
        db: dbOk ? "ok" : "fail",
        db_dialect: sqlDb.dialect,
        redis: redisStatus,
        pdr_proxy: pdrProxyHealthStatus({ origin: PDR_API_ORIGIN, reachable: pdrReachable }),
        // Mode A "bundled" only when tile assets actually exist on disk — empty
        // Mode A used to report "bundled" and look healthy with no map at all.
        indoor_map: indoorMapHealthStatus({
          upstream: INDOOR_MAP_UPSTREAM,
          upstreamReachable: indoorMapReachable,
          bundledTilesPresent: existsSync(LOCAL_INDOOR_MAP_TILES_DIR),
        }),
      },
      // Not part of overallOk: dropped telemetry degrades the operator map but
      // doesn't make this instance unfit to serve. Reported so silent loss is
      // observable — see lib/telemetryStats.ts.
      pax_telemetry: telemetryStatsSnapshot(),
      ts: new Date().toISOString(),
    },
  };
}

// Readiness: "can this instance actually serve real requests right now" —
// checks every dependency this process talks to. Use this (not /livez) to
// gate load-balancer routing in a multi-instance deployment, or for
// operator/monitoring visibility into dependency health.
app.get("/readyz", async (_req, res) => {
  const { overallOk, body } = await readinessBody();
  res.status(overallOk ? 200 : 503).json(body);
});

// Back-compat alias: existing docs/scripts/monitoring point at /health.
// Same dependency-aware body as /readyz — prefer /livez for container
// restart decisions and /readyz for the same check under an unambiguous name.
app.get("/health", async (_req, res) => {
  const { overallOk, body } = await readinessBody();
  res.status(overallOk ? 200 : 503).json(body);
});

// ─── Static assets + SPA fallback ─────────────────────────────────────────────
app.use(express.static(DIST_DIR));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not_found", path: req.path });
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(req.path)) return res.status(404).type("text/plain").send("Not found");
  res.sendFile(`${DIST_DIR}/index.html`);
});

// ─── Error handling (P2-5) ────────────────────────────────────────────────────
// Terminal middleware: capture any error thrown/forwarded by a route and return
// a generic 500. Must be the last app.use so it sees errors from all routes.
app.use(expressErrorHandler);

// ─── HTTP server + WebSocket hub ──────────────────────────────────────────────
const server = http.createServer(app);

if (pdrProxy) {
  server.on("upgrade", (req, socket, head) => {
    try {
      const pathname = new URL(req.url || "", "http://localhost").pathname;
      if (!pathname.startsWith("/pdr-api")) return;
      if (!isAllowedPdrUpgradePath(pathname)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      req.url = (req.url || "").replace(/^\/pdr-api(?=\/|$)/, "") || "/";
      (pdrProxy as unknown as { upgrade?: (r: typeof req, s: typeof socket, h: typeof head) => void }).upgrade?.(
        req,
        socket,
        head,
      );
    } catch { /* ignore invalid upgrade URLs */ }
  });
}

const wss = attachWsHub(server, store, registry);

/** Set once bootstrap() starts the pruning interval; cleared on shutdown(). */
let stopMaintenanceJobs: (() => void) | null = null;

/**
 * Re-stamps every locally-connected passenger's Redis presence entry — see
 * HubStore.heartbeatLocalPresence()/PRESENCE_STALE_MS. No-op (and cheap) when
 * Redis isn't configured. Interval is `unref()`d so it never keeps the
 * process alive on its own, but is still cleared explicitly on shutdown for
 * a prompt, clean exit rather than waiting on the unref'd timer.
 */
const PRESENCE_HEARTBEAT_INTERVAL_MS = 2 * 60_000;
const presenceHeartbeat = setInterval(() => store.heartbeatLocalPresence(), PRESENCE_HEARTBEAT_INTERVAL_MS);
presenceHeartbeat.unref();

async function bootstrap(): Promise<void> {
  // Load airport/tenant config from disk and hydrate the shared registries
  // before anything serves a request (Multi-airport Model B).
  hydrateRegistriesFromDisk({
    defaultAirport: process.env.DEFAULT_AIRPORT,
    defaultTenant: ROUTE_SITE_DEFAULT_TENANT,
  });

  // Create each store's baseline schema (idempotent CREATE TABLE IF NOT EXISTS —
  // safe to run on every boot) before serving.
  await Promise.all([
    registry.init(),
    chatRepo.init(),
    metricsRepo.init(),
    pushSubStore.init(),
    auditLog.init(),
    accountStore.init(),
    journeyStore.init(),
    paxInviteStore.init(),
  ]);
  // Then apply versioned migrations — anything a bare CREATE TABLE IF NOT
  // EXISTS can't express on a database that already has data (see
  // server/db/migrations.ts). Each one runs at most once, ever.
  await runMigrations(sqlDb, migrations);
  logger.info("db_ready", { dialect: sqlDb.dialect, redis: REDIS_ENABLED, instance: INSTANCE_ID });

  // Start background pruning only after tables exist. The disposer is
  // captured (not discarded) so `shutdown()` below can clear the interval.
  stopMaintenanceJobs = startMaintenanceJobs({ registry, chatRepo, metricsRepo, auditLog, hubStore: store });

  await loadPoiCache();
  server.listen(PORT, "0.0.0.0", () => {
    logger.info("server_listening", {
      url: `http://0.0.0.0:${PORT}`,
      admin: `http://localhost:${PORT}`,
      pax: `http://localhost:${PORT}/pax`,
    });
  });
}

void bootstrap().catch((err) => {
  logger.error("bootstrap_failed", { error: err instanceof Error ? err.message : String(err) });
  captureException(err, { phase: "bootstrap" });
  void flushErrorTracking(2000).finally(() => process.exit(1));
});

// ─── Graceful shutdown (P1-6) ─────────────────────────────────────────────────
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_start", { signal });

  try { stopMaintenanceJobs?.(); } catch { /* ignore */ }
  try { clearInterval(presenceHeartbeat); } catch { /* ignore */ }

  // Stop accepting new HTTP connections; close existing WS clients.
  if (wss) {
    for (const client of wss.clients) {
      try { client.close(1001, "server_shutdown"); } catch { /* ignore */ }
    }
  }

  const forceTimer = setTimeout(() => {
    logger.error("shutdown_forced", { reason: "timeout" });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close((err) => {
    if (err) {
      logger.error("shutdown_http_close_error", { error: String(err) });
      process.exit(1);
    }
    try { hubBus.close(); } catch { /* ignore */ }
    try { redisCmd?.disconnect(); } catch { /* ignore */ }
    void Promise.allSettled([sqlDb.close(), flushErrorTracking(2000)]).then(() => {
      logger.info("shutdown_complete", { signal });
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
