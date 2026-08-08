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
import { registerFidsRoutes } from "./routes/fids";
import { registerPushRoutes } from "./routes/push";
import { registerPassengerRoutes } from "./routes/passengers";
import { registerPaxSessionRoutes } from "./routes/paxSessions";
import { PassengerRegistry } from "./passengers/PassengerRegistry";
import { PaxAccountStore } from "./passengers/PaxAccountStore";
import { PushSubscriptionStore } from "./passengers/PushSubscriptionStore";
import { AuditLog } from "./lib/auditLog";
import { startMaintenanceJobs } from "./jobs/maintenance";
import { createRateLimiter } from "./middleware/rateLimit";
import { requestLog } from "./middleware/requestLog";
import { logger } from "./lib/logger";
import { indoorMapHealthStatus, pdrProxyHealthStatus } from "./lib/dependencyHealth";
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

const authRateLimit = createRateLimiter({ name: "auth", windowMs: 60_000, maxRequests: 20, redis: redisCmd });
const paxRateLimit = createRateLimiter({ name: "pax", windowMs: 60_000, maxRequests: 60, redis: redisCmd });
// GET /api/flight/closest and POST /api/transfer call FlightAware directly on
// every request (no FIDS cache) — cap per IP to protect the AeroAPI quota.
const aeroApiRateLimit = createRateLimiter({ name: "aeroapi", windowMs: 60_000, maxRequests: 30, redis: redisCmd });
const metricsRateLimit = createRateLimiter({ name: "metrics", windowMs: 60_000, maxRequests: 120, redis: redisCmd });

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
// Behind a reverse proxy (TLS terminator): trust the first hop for req.ip / proto (P1-10).
app.set("trust proxy", 1);
// Security headers.
//
// frameguard/COOP/CORP are enabled with same-origin settings: every iframe use
// in this app (route_site inside the dashboard, the indoor-map proxy) is
// same-origin, so this only blocks cross-origin framing/embedding, not the
// app's own documented usage.
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
app.use(requestLog);
app.use(express.json());
app.use(express.text({ type: () => true, limit: "4kb" }));
app.use(cookieParser());

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
// paxRateLimit is attached to the routers themselves (not via app.use(prefix, ...))
// because pushRouter is mounted at five different prefixes below. A limiter
// attached only to one app-level prefix would not apply when the same router's
// routes are reached through another prefix (e.g. /api/push/chat-send bypassing
// a limiter that was only wired on /api/pax).
const paxSessionRouter = express.Router();
paxSessionRouter.use(paxRateLimit);
registerPaxSessionRoutes(paxSessionRouter, registry, accountStore, auditLog);
app.use("/api/pax", paxSessionRouter);

const pushRouter = express.Router();
pushRouter.use(paxRateLimit);
registerPushRoutes(pushRouter, store, pushSubStore, auditLog);
app.use("/api/push",               pushRouter);
app.use("/api/pax",                pushRouter);
app.use("/api/orienta",            pushRouter);  // /api/orienta/presence, /tourist-*
app.use("/api/tourist-position",   pushRouter);
app.use("/api/tourist-deactivate", pushRouter);

// ─── Passenger management routes ──────────────────────────────────────────────
const passengerRouter = express.Router();
registerPassengerRoutes(passengerRouter, store, registry, auditLog, pushSubStore);
app.use("/api/passengers", passengerRouter);

// ─── Indoor map proxy / bundled tiles ────────────────────────────────────────
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7m9JwAAAABJRU5ErkJggg==",
  "base64"
);

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
        const html = transformAirportMapHtmlFromSource(readFileSync(REPO_AIRPORT_MAP_PATH, "utf8"));
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

// ─── PDR proxy ────────────────────────────────────────────────────────────────
// PDR uses WebSocket (/pdr-api/ws/pdr/{session_id}); upgrade must be wired on the HTTP server (see below).
let pdrProxy: ReturnType<typeof createProxyMiddleware> | null = null;
if (PDR_API_ORIGIN) {
  pdrProxy = createProxyMiddleware({ target: PDR_API_ORIGIN, changeOrigin: true, ws: true, pathRewrite: { "^/pdr-api": "" } });
  app.use("/pdr-api", pdrProxy);
  logger.info("pdr_api_proxy", { target: PDR_API_ORIGIN });
} else {
  app.use("/pdr-api", (_req, res) => res.status(503).json({ error: "pdr_proxy_disabled", message: "Set PDR_API_ORIGIN env var to enable." }));
}

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
