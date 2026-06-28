/**
 * PEK T3E gate coordinates — loaded live from indoor-map-api, with static fallback.
 *
 * Updated: import type { LatLng } from "../types/types"
 */
import type { LatLng } from "../types/types";
import {
  extractPekGateKey,
  isPekFloorL3,
  isPekGateCategory,
  pekGateFloorRank,
  normalizePekGate,
  readFeatureLatLng,
} from "../lib/pekPoiParse";
import { apiUrl } from "../config/api";

/** Same POI source as route_site / airport-map (`/indoor-map-api/api/poi?terminal=T3E`). */
export function pekPoiApiBase(): string {
  const env = import.meta.env.VITE_INDOOR_MAP_API_BASE;
  if (typeof env === "string" && env.trim()) return env.trim().replace(/\/+$/, "");
  return "/indoor-map-api";
}

const DEFAULT_SPINE: LatLng = { lat: 40.0748162, lng: 116.6061088 };
const DEFAULT_BBOX = {
  minLat: 40.0694,
  maxLat: 40.0800,
  minLng: 116.6008,
  maxLng: 116.6108,
};

let gateCache: Record<string, LatLng> | null = null;
let amenityCache: LatLng[] | null = null;
let spineCache: LatLng | null = null;
let bboxCache: typeof DEFAULT_BBOX | null = null;
let loadPromise: Promise<void> | null = null;

function ingestPoiFeatures(features: unknown[]): void {
  const gates: Record<string, LatLng> = {};
  const floorRankMap: Record<string, number> = {};
  const waypoints: LatLng[] = [];

  for (const raw of features) {
    const f = raw as {
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: number[] };
    };
    const props = f.properties || {};
    const cat = String(props.category || "").toLowerCase();
    const ll = readFeatureLatLng(props, f.geometry?.coordinates);
    if (!ll) continue;

    if (isPekGateCategory(cat)) {
      const key = extractPekGateKey(props);
      if (!key || !/^E\d{1,2}$/.test(key)) continue;
      const rk = pekGateFloorRank(props.floor);
      if (floorRankMap[key] == null || rk >= floorRankMap[key]) {
        floorRankMap[key] = rk;
        gates[key] = ll;
      }
    } else if (cat === "waypoint" && isPekFloorL3(props.floor)) {
      waypoints.push(ll);
    }
  }

  gateCache = gates;
  amenityCache = pickAmenityPoints(gates, waypoints);
  spineCache = computeCentroid(Object.values(gates)) ?? DEFAULT_SPINE;
  bboxCache = computeBbox(Object.values(gates)) ?? DEFAULT_BBOX;
}

function computeCentroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of points) { lat += p.lat; lng += p.lng; }
  return { lat: lat / points.length, lng: lng / points.length };
}

function computeBbox(points: LatLng[]): typeof DEFAULT_BBOX | null {
  if (points.length < 2) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const pad = 0.0005;
  return { minLat: minLat - pad, maxLat: maxLat + pad, minLng: minLng - pad, maxLng: maxLng + pad };
}

function pickAmenityPoints(gates: Record<string, LatLng>, waypoints: LatLng[]): LatLng[] {
  if (waypoints.length >= 3) {
    const step = Math.max(1, Math.floor(waypoints.length / 6));
    const picked: LatLng[] = [];
    for (let i = 0; i < waypoints.length && picked.length < 6; i += step) picked.push(waypoints[i]);
    return picked;
  }
  const keys = Object.keys(gates).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  if (!keys.length) return [];
  const idx = [0, 0.2, 0.4, 0.55, 0.75, 0.9].map((t) =>
    Math.min(keys.length - 1, Math.floor(t * (keys.length - 1))),
  );
  const seen = new Set<number>();
  return idx.filter((i) => { if (seen.has(i)) return false; seen.add(i); return true; })
    .map((i) => gates[keys[i]]);
}

export async function preloadPekPoiFromMapApi(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const url = apiUrl(`${pekPoiApiBase()}/api/poi?terminal=T3E`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`POI HTTP ${res.status}`);
    const data = (await res.json()) as { features?: unknown[] };
    ingestPoiFeatures(Array.isArray(data.features) ? data.features : []);
  })();
  try {
    await loadPromise;
  } catch {
    gateCache = gateCache ?? {};
    amenityCache = amenityCache ?? [];
    spineCache = spineCache ?? DEFAULT_SPINE;
    bboxCache = bboxCache ?? DEFAULT_BBOX;
  }
}

export function isPekPoiLoaded(): boolean {
  return gateCache != null && Object.keys(gateCache).length > 0;
}

export function getPekGateCoords(): Record<string, LatLng> {
  return gateCache ? { ...gateCache } : {};
}

export function getPekGateCoord(gateName: string): LatLng | null {
  const gate = normalizePekGate(gateName);
  return gateCache?.[gate] ?? null;
}

export function getPekIndoorAmenities(): LatLng[] {
  return amenityCache?.length ? [...amenityCache] : [];
}

export function getT3ESpineCenter(): LatLng {
  return spineCache ? { ...spineCache } : { ...DEFAULT_SPINE };
}

export function getT3EBbox(): typeof DEFAULT_BBOX {
  return bboxCache ? { ...bboxCache } : { ...DEFAULT_BBOX };
}
