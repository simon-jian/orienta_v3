/**
 * Flight & airport data routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Key change: gate coordinates are now imported from the single-source
 * airport config files (data/airports/pek.ts + sfo.ts) rather than
 * being duplicated here.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Router, Request, Response } from "express";
import { FLIGHTAWARE_API_KEY } from "../config";
import { DIST_DIR, ROUTE_SITE_DIR, PEK_CSV_PATH, PEK_VIDEO_CONCAT_SCRIPT } from "../paths";
import { getGateCoord, getAllGateCoords, getPekCenter } from "../lib/poiCache";
import { SFO_CENTER, SFO_GATE_COORDS } from "../../src/data/airports/sfo";

// ─── Airport data ─────────────────────────────────────────────────────────────

function getPekCenter2(): [number, number] {
  const c = getPekCenter();
  return [c.lat, c.lng];
}

function getSfoCenter(): [number, number] {
  return [SFO_CENTER.lat, SFO_CENTER.lng];
}

function getAirportCenter(airport: string): [number, number] | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getPekCenter2();
  if (airport === "SFO" || airport === "KSFO") return getSfoCenter();
  return undefined;
}

const SFO_GATE_COORDS_FLAT = Object.fromEntries(
  Object.entries(SFO_GATE_COORDS).map(([k, v]) => [k, [v.lat, v.lng] as [number, number]])
);

function getAirportGates(airport: string): Record<string, [number, number]> | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getAllGateCoords();
  if (airport === "SFO" || airport === "KSFO") return SFO_GATE_COORDS_FLAT;
  return undefined;
}

function getAirportGateCoord(airport: string, gate: string): [number, number] | undefined {
  if (airport === "PEK" || airport === "ZBAA") return getGateCoord(gate) ?? undefined;
  if (airport === "SFO" || airport === "KSFO") return SFO_GATE_COORDS_FLAT[gate];
  return undefined;
}

// ─── FlightAware ──────────────────────────────────────────────────────────────

interface FlightResult {
  flight_iata: string;
  dep_iata: string;
  arr_iata: string;
  dep_time_local: string;
  arr_time_local: string;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  status: string;
}

function normalizeFlight(s: string): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

async function fetchFlightAware(flightIdent: string): Promise<FlightResult> {
  if (!FLIGHTAWARE_API_KEY) throw new Error("FLIGHTAWARE_API_KEY not configured");

  const utc   = new Date();
  const start = new Date(utc); start.setDate(start.getDate() - 2);
  const end   = new Date(utc); end.setDate(end.getDate() + 2);

  const params = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    max_pages: "1",
  });

  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightIdent)}?${params}`;
  const res = await fetch(url, { headers: { "x-apikey": FLIGHTAWARE_API_KEY, Accept: "application/json" } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }

  const j = await res.json() as Record<string, unknown>;
  const flights = Array.isArray(j.flights) ? j.flights : [];
  if (flights.length === 0) throw new Error(`No flights found for ${flightIdent}`);

  const f = flights[0] as Record<string, unknown>;
  const origin = (f.origin as Record<string, unknown>) || {};
  const dest = (f.destination as Record<string, unknown>) || {};

  const toLocal = (iso: unknown, tz: unknown): string => {
    if (typeof iso !== "string" || !iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-CA", {
        timeZone: typeof tz === "string" ? tz : "UTC",
        year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).replace(",", "");
    } catch { return iso.slice(0, 16).replace("T", " "); }
  };

  const str = (v: unknown, fallback = "—"): string =>
    typeof v === "string" && v ? v : fallback;

  const iata = (obj: Record<string, unknown>): string => {
    const v = typeof obj.code_iata === "string" && obj.code_iata ? obj.code_iata : "";
    return v || str(obj.code);
  };

  return {
    flight_iata: f.operator_iata && f.flight_number
      ? `${f.operator_iata}${f.flight_number}`
      : flightIdent,
    dep_iata: iata(origin),
    arr_iata: iata(dest),
    dep_time_local: toLocal(f.scheduled_out ?? f.scheduled_off, origin.timezone),
    arr_time_local: toLocal(f.scheduled_in ?? f.scheduled_on, dest.timezone),
    dep_terminal: str(f.terminal_origin),
    dep_gate: str(f.gate_origin),
    arr_terminal: str(f.terminal_destination),
    arr_gate: str(f.gate_destination),
    status: str(f.status, "Scheduled"),
  };
}

function toInstanceDict(inst: FlightResult): Omit<FlightResult, "status"> {
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
