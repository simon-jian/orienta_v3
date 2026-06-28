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
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createProxyMiddleware } from "http-proxy-middleware";

import { PORT, PDR_API_ORIGIN, INDOOR_MAP_UPSTREAM, INDOOR_MAP_API_UPSTREAM, VITE_LOCAL_AIRPORT_MAP, DB_PATH } from "./config";
import {
  DIST_DIR, REPO_AIRPORT_MAP_PATH,
  LOCAL_INDOOR_MAP_API_DIR, LOCAL_INDOOR_MAP_TILES_DIR,
} from "./paths";
import { HubStore, attachWsHub } from "./hub/wsHub";
import { ChatRepository } from "./hub/ChatRepository";
import { registerAuthRoutes } from "./routes/auth";
import { registerFlightRoutes, registerOrientaRoutes } from "./routes/flight";
import { registerPushRoutes } from "./routes/push";
import { registerPassengerRoutes } from "./routes/passengers";
import { registerPaxSessionRoutes } from "./routes/paxSessions";
import { PassengerRegistry } from "./passengers/PassengerRegistry";
import { PaxAccountStore } from "./passengers/PaxAccountStore";
import { AuditLog } from "./lib/auditLog";
import { startMaintenanceJobs } from "./jobs/maintenance";
import { createRateLimiter } from "./middleware/rateLimit";
import { requestLog } from "./middleware/requestLog";
import { logger } from "./lib/logger";
import { MetricsRepository } from "./lib/MetricsRepository";
import { registerMetricsRoutes } from "./routes/metrics";
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

// ─── Shared hub store + SQLite services ──────────────────────────────────────
const chatRepo = new ChatRepository(DB_PATH);
const store = new HubStore(chatRepo);
const accountStore = new PaxAccountStore(DB_PATH);
const auditLog = new AuditLog(DB_PATH);
const metricsRepo = new MetricsRepository(DB_PATH);

// ─── Passenger registry ───────────────────────────────────────────────────────
const registry = new PassengerRegistry(DB_PATH);
logger.info("passenger_registry_ready", { dbPath: DB_PATH });

const authRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
const paxRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
// P0-5: the merged-video route spawns ffmpeg/python on cache-miss — strict cap per IP.
const mergedVideoRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
const metricsRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
// Behind a reverse proxy (TLS terminator): trust the first hop for req.ip / proto (P1-10).
app.set("trust proxy", 1);
// Security headers. CSP / cross-origin isolation are disabled because legacy
// pages use inline scripts and same-origin iframes (route_site, indoor map).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
  frameguard: false,
}));
app.use(requestLog);
app.use(express.json());
app.use(express.text({ type: () => true, limit: "4kb" }));
app.use(cookieParser());

// ─── Client metrics ingestion (P1-5) ──────────────────────────────────────────
const metricsRouter = express.Router();
registerMetricsRoutes(metricsRouter, metricsRepo);
app.use("/api/metrics", metricsRateLimit, metricsRouter);

// ─── Auth routes ──────────────────────────────────────────────────────────────
const authRouter = express.Router();
registerAuthRoutes(authRouter, auditLog);
app.use("/api/auth", authRateLimit, authRouter);

// ─── Flight / airport routes ──────────────────────────────────────────────────
const flightRouter = express.Router();
registerFlightRoutes(flightRouter);
app.use("/api", flightRouter);
app.use("/flight", flightRouter);

// ─── Orienta-specific routes ──────────────────────────────────────────────────
// Strict limiter on the expensive video-merge endpoint (must precede the router mount).
app.use("/api/orienta/pek-merged-video", mergedVideoRateLimit);
const orientaRouter = express.Router();
registerOrientaRoutes(orientaRouter);
app.use("/api/orienta", orientaRouter);

// ─── Push / presence / tourist routes ─────────────────────────────────────────
const paxSessionRouter = express.Router();
registerPaxSessionRoutes(paxSessionRouter, registry, accountStore, auditLog);
app.use("/api/pax", paxRateLimit);
app.use("/api/pax", paxSessionRouter);

const pushRouter = express.Router();
registerPushRoutes(pushRouter, store, auditLog);
app.use("/api/push",               pushRouter);
app.use("/api/pax",                pushRouter);
app.use("/api/orienta",            pushRouter);  // /api/orienta/presence, /tourist-*
app.use("/api/tourist-position",   pushRouter);
app.use("/api/tourist-deactivate", pushRouter);

// ─── Passenger management routes ──────────────────────────────────────────────
const passengerRouter = express.Router();
registerPassengerRoutes(passengerRouter, store, registry, auditLog);
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
// Process alive + SQLite ping. PDR is reported best-effort and never fails the probe.
const SERVER_START_MS = Date.now();
app.get("/health", (_req, res) => {
  let dbOk = false;
  try { dbOk = chatRepo.ping(); } catch { dbOk = false; }
  const body = {
    status: dbOk ? "ok" : "degraded",
    uptime_s: Math.round((Date.now() - SERVER_START_MS) / 1000),
    checks: {
      process: "ok",
      sqlite: dbOk ? "ok" : "fail",
      pdr_proxy: PDR_API_ORIGIN ? "configured" : "disabled",
      indoor_map: INDOOR_MAP_UPSTREAM ? "upstream" : "bundled",
    },
    ts: new Date().toISOString(),
  };
  res.status(dbOk ? 200 : 503).json(body);
});

// ─── Static assets + SPA fallback ─────────────────────────────────────────────
app.use(express.static(DIST_DIR, {
  setHeaders(res, filePath) {
    if (/\.mp4$/i.test(filePath)) res.setHeader("Content-Type", "video/mp4");
  },
}));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not_found", path: req.path });
  if (/\.(mp4|webm|m4v|mov|csv|png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(req.path)) return res.status(404).type("text/plain").send("Not found");
  res.sendFile(`${DIST_DIR}/index.html`);
});

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
startMaintenanceJobs({ registry, chatRepo, metricsRepo });

loadPoiCache().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    logger.info("server_listening", {
      url: `http://0.0.0.0:${PORT}`,
      admin: `http://localhost:${PORT}`,
      pax: `http://localhost:${PORT}/pax?pid=TX1&direct=1`,
    });
  });
});

// ─── Graceful shutdown (P1-6) ─────────────────────────────────────────────────
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_start", { signal });

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
    logger.info("shutdown_complete", { signal });
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
