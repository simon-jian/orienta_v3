/**
 * Flight & airport data routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Key change: gate coordinates are loaded from the PEK POI cache (T3E indoor map API).
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Router, Request, Response } from "express";
import { DIST_DIR, ROUTE_SITE_DIR, PEK_CSV_PATH, PEK_VIDEO_CONCAT_SCRIPT } from "../paths";
import { getGateCoord, getAllGateCoords, getPekCenter } from "../lib/poiCache";
import { type FlightResult, normalizeFlight, fetchFlightAware } from "../services/flightAware";

// ─── Airport data (PEK / ZBAA only) ───────────────────────────────────────────

function getPekCenter2(): [number, number] {
  const c = getPekCenter();
  return [c.lat, c.lng];
}

function getAirportCenter(airport: string): [number, number] | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getPekCenter2();
  return undefined;
}

function getAirportGates(airport: string): Record<string, [number, number]> | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getAllGateCoords();
  return undefined;
}

function getAirportGateCoord(airport: string, gate: string): [number, number] | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getGateCoord(gate) ?? undefined;
  return undefined;
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

export function registerOrientaRoutes(router: Router): void {
  router.get("/pek-merged-video", (req: Request, res: Response) => {
    const from    = normalizeGateToken(String(req.query.from || req.query.gateFrom || req.query.origin || ""));
    const to      = normalizeGateToken(String(req.query.to   || req.query.gateTo   || req.query.destination || req.query.dest || ""));
    const fromIdx = parseInt(String(req.query.fromIdx ?? req.query.from_index ?? ""), 10);
    const toIdx   = parseInt(String(req.query.toIdx   ?? req.query.to_index   ?? ""), 10);
    const useIdx  = Number.isFinite(fromIdx) && Number.isFinite(toIdx) && fromIdx >= 0 && toIdx > fromIdx;
    if (!useIdx && (!from || !to)) return res.status(400).json({ ok: false, error: "missing_from_or_to_gate_or_index" });

    const distRouteSite = path.join(DIST_DIR, "route_site");
    const outDir = existsSync(distRouteSite)
      ? path.join(distRouteSite, "dynamic")
      : path.join(ROUTE_SITE_DIR, "dynamic");
    const outName = useIdx
      ? `PEK_gate_timestamp_merged_idx_${fromIdx}_to_${toIdx}.mp4`
      : `PEK_gate_timestamp_merged_${from}_to_${to}.mp4`;
    const outPath = path.join(outDir, outName);
    const pyArgs = useIdx
      ? [PEK_VIDEO_CONCAT_SCRIPT, "--csv", PEK_CSV_PATH, "--src-dir", ROUTE_SITE_DIR, "--out", outPath, "--from-index", String(fromIdx), "--to-index", String(toIdx)]
      : [PEK_VIDEO_CONCAT_SCRIPT, "--csv", PEK_CSV_PATH, "--src-dir", ROUTE_SITE_DIR, "--out", outPath, "--from-gate", from, "--to-gate", to];

    try {
      mkdirSync(outDir, { recursive: true });
      if (existsSync(outPath)) {
        const st = statSync(outPath);
        if (st.isFile() && st.size > 0) {
          return res.json({ ok: true, url: `/route_site/dynamic/${outName}`, cached: true, bytes: st.size });
        }
      }
      const run = spawnSync("python3", pyArgs, { encoding: "utf8", timeout: 120_000 });
      if (run.status !== 0) {
        return res.status(500).json({ ok: false, error: "merge_failed", details: (run.stderr || run.stdout || "").slice(-1200) });
      }
      const st2 = statSync(outPath);
      return res.json({ ok: true, url: `/route_site/dynamic/${outName}`, cached: false, bytes: st2.size });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: "merge_exception", message });
    }
  });

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
