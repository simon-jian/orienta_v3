/**
 * Flight & airport data routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Key change: gate coordinates are loaded from the PEK POI cache (T3E indoor map API).
 */
import type { Router, Request, Response } from "express";
import { getGateCoord, getAllGateCoords, getPekCenter } from "../lib/poiCache";
import { type FlightResult, normalizeFlight, fetchFlightAware } from "../services/flightAware";
import { requestMerge, type MergeSpec } from "../services/videoMerge";
import { getAirport } from "../../src/config/airports/registry";

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

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFlightRoutes(router: Router): void {
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

  router.get("/flight/closest", async (req: Request, res: Response) => {
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
      const message = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: "provider_error", message });
    }
  });

  router.post("/transfer", async (req: Request, res: Response) => {
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
      const message = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: "provider_error", message });
    }
  });

  // Legacy Python fallback (dev FIDS tries /flight/* first)
  router.get("/:mode", (_req, res) => res.json({ ok: true, data: [] }));
}

// ─── PEK route-site merged video ─────────────────────────────────────────────

function normalizeGateToken(raw: string): string {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^GATE_/, "");
}

/**
 * Merged route-video handler, airport-aware (Multi-airport Phase 4).
 *
 * `airportId` is undefined for the legacy `/pek-merged-video` alias (→ PEK) and
 * set from the path param for the generalized `/:airportId/merged-video`. The
 * merge assets/script are PEK-only today, so other (valid) airports return 501.
 */
async function handleMergedVideo(req: Request, res: Response, airportId?: string): Promise<Response> {
  const requested = String(airportId || "PEK").toUpperCase();
  const def = getAirport(requested);
  if (!def) return res.status(404).json({ ok: false, error: "unknown_airport", airportId: requested });
  if (def.id !== "PEK") {
    return res.status(501).json({ ok: false, error: "merge_not_supported_for_airport", airportId: def.id });
  }

  const from    = normalizeGateToken(String(req.query.from || req.query.gateFrom || req.query.origin || ""));
  const to      = normalizeGateToken(String(req.query.to   || req.query.gateTo   || req.query.destination || req.query.dest || ""));
  const fromIdx = parseInt(String(req.query.fromIdx ?? req.query.from_index ?? ""), 10);
  const toIdx   = parseInt(String(req.query.toIdx   ?? req.query.to_index   ?? ""), 10);
  const useIdx  = Number.isFinite(fromIdx) && Number.isFinite(toIdx) && fromIdx >= 0 && toIdx > fromIdx;
  if (!useIdx && (!from || !to)) return res.status(400).json({ ok: false, error: "missing_from_or_to_gate_or_index" });

  const spec: MergeSpec = useIdx
    ? { mode: "index", fromIdx, toIdx }
    : { mode: "gate", from, to };

  try {
    // CPU work runs in the worker (Redis) or a non-blocking child process.
    const result = await requestMerge(spec);
    return res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const error = message === "merge_timeout" ? "merge_timeout" : "merge_failed";
    return res.status(message === "merge_timeout" ? 504 : 500).json({ ok: false, error, message: message.slice(-1200) });
  }
}

export function registerOrientaRoutes(router: Router): void {
  // Generalized, airport-scoped endpoint (Multi-airport Phase 4).
  router.get("/:airportId/merged-video", (req: Request, res: Response) => handleMergedVideo(req, res, req.params.airportId));
  // Legacy PEK alias (kept for existing route_site links / QR codes).
  router.get("/pek-merged-video", (req: Request, res: Response) => handleMergedVideo(req, res, "PEK"));

  router.get("/route-site-map-embed", (req: Request, res: Response) => {
    const host    = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const proto   = xfProto === "https" || xfProto === "http" ? xfProto : ((req as any).secure ? "https" : "http");
    const publicOrigin = host ? `${proto}://${host}` : "";

    const e = (k: string) => String(process.env[k] || "").trim();
    const sameOrigin = e("VITE_INDOOR_MAP_SAME_ORIGIN") === "1" || e("VITE_ROUTE_SITE_INDOOR_MAP_SAME_ORIGIN") === "1";
    let url     = e("VITE_INDOOR_MAP_URL")      || e("VITE_ROUTE_SITE_INDOOR_MAP_URL");
    let apiBase = e("VITE_INDOOR_MAP_API_BASE") || e("VITE_ROUTE_SITE_INDOOR_MAP_API_BASE");
    const tileBase = e("VITE_INDOOR_MAP_TILE_BASE") || e("VITE_ROUTE_SITE_INDOOR_TILE_BASE");
    let tileUrl = e("VITE_INDOOR_MAP_TILE_URL") || e("VITE_ROUTE_SITE_INDOOR_TILE_URL");

    if (sameOrigin && publicOrigin) {
      url = `${publicOrigin}/indoor-map/airport-map.html`;
      apiBase = `${publicOrigin}/indoor-map-api`;
      tileUrl = `${publicOrigin}/indoor-map/tile/{z}/{x}/{y}.png`;
    }

    res.json({ url: url || null, apiBase: url && apiBase ? apiBase : null, tileBase: url && tileBase ? tileBase : null, tileUrl: url && tileUrl ? tileUrl : null });
  });

  router.get("/presence", (_req: Request, res: Response) => {
    // Implemented in push.ts (needs HubStore access) — stub here for route registration order
    res.status(501).json({ ok: false, error: "use_push_router" });
  });
}
