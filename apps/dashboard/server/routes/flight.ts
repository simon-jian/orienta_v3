/**
 * Flight & airport data routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Key change: gate coordinates are loaded from the PEK POI cache (T3E indoor map API).
 */
import type { Router, Request, Response, RequestHandler, NextFunction } from "express";
import { getGateCoord, getAllGateCoords, getPekCenter } from "../lib/poiCache";
import { type FlightResult, normalizeFlight, fetchFlightAware } from "../services/flightAware";
import { getAirport } from "../../src/config/airports/registry";
import { logger } from "../lib/logger";

// ─── Airport data (registry-driven; PEK is the only indoor_api hub today) ──────

/**
 * Whether an airport code (id / IATA / ICAO, e.g. "PEK" or "ZBAA") resolves to a
 * hub whose gate coordinates are served from the POI cache. Today only PEK, but
 * this no longer hardcodes the airport string (Multi-airport Phase 2).
 */
function isPoiCacheAirport(airport: string): boolean {
  const def = getAirport(airport);
  return !!def && def.poi.mode === "indoor_api";
}

function getAirportCenter(airport: string): [number, number] | undefined {
  if (!isPoiCacheAirport(airport)) return undefined;
  const c = getPekCenter();
  return [c.lat, c.lng];
}

function getAirportGates(airport: string): Record<string, [number, number]> | undefined {
  return isPoiCacheAirport(airport) ? getAllGateCoords() : undefined;
}

function getAirportGateCoord(airport: string, gate: string): [number, number] | undefined {
  return isPoiCacheAirport(airport) ? (getGateCoord(gate) ?? undefined) : undefined;
}

// ─── FlightAware (client extracted to ../services/flightAware) ─────────────────

type FlightInstanceDict = Pick<
  FlightResult,
  | "flight_iata" | "dep_iata" | "arr_iata" | "dep_time_local" | "arr_time_local"
  | "dep_terminal" | "dep_gate" | "arr_terminal" | "arr_gate"
>;

function toInstanceDict(inst: FlightResult): FlightInstanceDict {
  return {
    flight_iata: inst.flight_iata,
    dep_iata: inst.dep_iata,
    arr_iata: inst.arr_iata,
    dep_time_local: inst.dep_time_local,
    arr_time_local: inst.arr_time_local,
    dep_terminal: inst.dep_terminal,
    dep_gate: inst.dep_gate,
    arr_terminal: inst.arr_terminal,
    arr_gate: inst.arr_gate,
  };
}

import { estimateWalkingTime } from "../../src/utils/geo";

// ─── Walk distance helper ─────────────────────────────────────────────────────

function walkDistance(fromCenter: [number, number], toCenter: [number, number]): { m: number; min: number } {
  const estimate = estimateWalkingTime(fromCenter, toCenter);
  return { m: estimate.meters, min: estimate.minutes };
}

/** Logs the real error server-side; never forwards provider error bodies to clients. */
function respondProviderError(res: Response, context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn("flightaware_lookup_failed", { context, error: message });
  res.status(502).json({ ok: false, error: "provider_error" });
}

// ─── Route registration ───────────────────────────────────────────────────────

/**
 * @param aeroApiRateLimit Optional limiter applied to the two routes that call
 *   FlightAware directly (bypassing the FIDS cache) — protects both the AeroAPI
 *   quota and this process from being used as an amplification proxy.
 */
export function registerFlightRoutes(router: Router, aeroApiRateLimit?: RequestHandler): void {
  const limitAeroApi: RequestHandler = aeroApiRateLimit ?? ((_req, _res, next: NextFunction) => next());

  router.get("/airport", (req: Request, res: Response) => {
    const airport = (req.query.airport as string || "").toUpperCase();
    if (!airport) return res.status(400).json({ ok: false, error: "missing_airport" });
    const center = getAirportCenter(airport) || getAirportCenter(airport.slice(0, 3));
    if (!center) return res.status(404).json({ ok: false, error: "airport_not_found" });
    res.json({ ok: true, data: { airport, center } });
  });

  router.get("/gate", (req: Request, res: Response) => {
    const airport = (req.query.airport as string || "").toUpperCase();
    const gate    = (req.query.gate    as string || "").toUpperCase();
    if (!airport || !gate) return res.status(400).json({ ok: false, error: "missing_airport_or_gate" });
    const gates = getAirportGates(airport) || getAirportGates(airport.slice(0, 3));
    if (!gates) return res.status(404).json({ ok: false, error: "airport_not_found" });
    const center = getAirportGateCoord(airport, gate) || getAirportGateCoord(airport.slice(0, 3), gate);
    if (!center) {
      const airCenter = getAirportCenter(airport) || getAirportCenter(airport.slice(0, 3));
      if (airCenter) return res.json({ ok: true, data: { center: airCenter } });
      return res.status(404).json({ ok: false, error: "gate_not_found" });
    }
    res.json({ ok: true, data: { center } });
  });

  router.get("/flight/closest", limitAeroApi, async (req: Request, res: Response) => {
    const raw = (req.query.q as string || req.query.flight as string || "").trim();
    const flightIdent = normalizeFlight(raw);
    if (!flightIdent) return res.status(400).json({ ok: false, error: "missing_flight" });
    try {
      const inst = await fetchFlightAware(flightIdent);
      const badgeLabel = (inst.status || "").toUpperCase().trim() || "SCHEDULED";
      const badgeClass = /en route|depart|arriv|land/i.test(badgeLabel) ? "ok" : "neutral";
      res.json({
        ok: true,
        data: {
          query: raw, flight_ident: flightIdent,
          instance: toInstanceDict(inst),
          badge: { label: badgeLabel, class: badgeClass },
          updated: "now", provider: "FlightAware",
        },
      });
    } catch (e: unknown) {
      respondProviderError(res, "flight/closest", e);
    }
  });

  router.post("/transfer", limitAeroApi, async (req: Request, res: Response) => {
    const body = req.body || {};
    const arrIdent = normalizeFlight(String(body.arrFlight || body.arrivalFlight || body.arr || ""));
    const depIdent = normalizeFlight(String(body.depFlight || body.departureFlight || body.dep || ""));
    if (!arrIdent || !depIdent) return res.status(400).json({ ok: false, error: "missing_flights" });
    try {
      const [arrInst, depInst] = await Promise.all([fetchFlightAware(arrIdent), fetchFlightAware(depIdent)]);
      const hub      = (arrInst.arr_iata || depInst.dep_iata || "").toUpperCase();
      const fromGate = arrInst.arr_gate || "—";
      const toGate   = depInst.dep_gate || "—";
      const fromCenter = getAirportGateCoord(hub, fromGate);
      const toCenter   = getAirportGateCoord(hub, toGate);
      const walk = fromCenter && toCenter ? walkDistance(fromCenter, toCenter) : null;
      res.json({
        ok: true,
        data: {
          arrival: toInstanceDict(arrInst), departure: toInstanceDict(depInst),
          hub_airport: hub, from_gate: fromGate, to_gate: toGate,
          walk_distance_m: walk?.m ?? null, walk_time_min: walk?.min ?? null,
          provider: "FlightAware",
        },
      });
    } catch (e: unknown) {
      respondProviderError(res, "transfer", e);
    }
  });

}

/**
 * Legacy Python/FIDS dev fallback: any unmatched `GET /<mode>` under this
 * router returns an empty result instead of a 404 (old dev tooling probed a
 * few `/flight/*` paths speculatively).
 *
 * IMPORTANT: mount this only on a router reserved for the `/flight` prefix.
 * It matches a single path segment, so mounting it under the broad `/api`
 * prefix would shadow any other single-segment route registered afterwards
 * (this previously broke `GET /api/passengers`, which is a single segment
 * under `/api` — Express resolves overlapping `app.use()` mounts in
 * registration order, not by prefix specificity).
 */
export function registerLegacyFlightFallback(router: Router): void {
  router.get("/:mode", (_req, res) => res.json({ ok: true, data: [] }));
}

export function registerOrientaRoutes(router: Router): void {
  // Video route navigation was retired (2026-08) — map + PDR live elsewhere.
  // Keep a clear 410 so old QR codes / bookmarks fail loudly instead of 404ing.
  const gone = (_req: Request, res: Response) => {
    res.status(410).json({
      ok: false,
      error: "video_navigation_retired",
      message: "Merged route video is no longer served. Use /pax/app for map + PDR navigation.",
    });
  };
  router.get("/:airportId/merged-video", gone);
  router.get("/pek-merged-video", gone);

  router.get("/route-site-map-embed", (_req: Request, res: Response) => {
    const e = (k: string) => String(process.env[k] || "").trim();
    const sameOrigin = e("VITE_INDOOR_MAP_SAME_ORIGIN") === "1" || e("VITE_ROUTE_SITE_INDOOR_MAP_SAME_ORIGIN") === "1";
    let url     = e("VITE_INDOOR_MAP_URL")      || e("VITE_ROUTE_SITE_INDOOR_MAP_URL");
    let apiBase = e("VITE_INDOOR_MAP_API_BASE") || e("VITE_ROUTE_SITE_INDOOR_MAP_API_BASE");
    const tileBase = e("VITE_INDOOR_MAP_TILE_BASE") || e("VITE_ROUTE_SITE_INDOOR_TILE_BASE");
    let tileUrl = e("VITE_INDOOR_MAP_TILE_URL") || e("VITE_ROUTE_SITE_INDOOR_TILE_URL");

    // Same-origin means "this API and the map live behind the same host", so a
    // *relative* path resolves correctly for the caller with no origin needed
    // at all — which also means there's no client-controlled host header to
    // spoof. (Previously this built an absolute URL from X-Forwarded-Host /
    // X-Forwarded-Proto, which a request could forge to point route_site's
    // map embed at an attacker-controlled origin.)
    if (sameOrigin) {
      url = "/indoor-map/airport-map.html";
      apiBase = "/indoor-map-api";
      tileUrl = "/indoor-map/tile/{z}/{x}/{y}.png";
    }

    res.json({ url: url || null, apiBase: url && apiBase ? apiBase : null, tileBase: url && tileBase ? tileBase : null, tileUrl: url && tileUrl ? tileUrl : null });
  });

  router.get("/presence", (_req: Request, res: Response) => {
    // Implemented in push.ts (needs HubStore access) — stub here for route registration order
    res.status(501).json({ ok: false, error: "use_push_router" });
  });
}
