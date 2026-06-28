/**
 * Server-side POI coordinate cache — loaded from INDOOR_MAP_API_UPSTREAM at startup.
 */
import { INDOOR_MAP_API_UPSTREAM, DEFAULT_TERMINAL } from "../config";
import {
  extractPekGateKey,
  isPekGateCategory,
  normalizePekGate,
  pekGateFloorRank,
  readFeatureLatLng,
} from "../../src/lib/pekPoiParse";

type LatLng = { lat: number; lng: number };
type Bbox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const DEFAULT_CENTER: LatLng = { lat: 40.0748162, lng: 116.6061088 };
const DEFAULT_BBOX: Bbox = {
  minLat: 40.0694, maxLat: 40.0800, minLng: 116.6008, maxLng: 116.6108,
};

let gateCache: Record<string, [number, number]> = {};
let centerCache: LatLng = DEFAULT_CENTER;
let bboxCache: Bbox = DEFAULT_BBOX;

function ingestFeatures(features: unknown[]): void {
  const gates: Record<string, [number, number]> = {};
  const floorRankMap: Record<string, number> = {};

  for (const raw of features) {
    const feature = raw as { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } };
    const props = feature.properties || {};
    if (!isPekGateCategory(props.category)) continue;

    const latLng = readFeatureLatLng(props, feature.geometry?.coordinates);
    if (!latLng) continue;

    const key = extractPekGateKey(props);
    if (!key || !/^E\d{1,2}$/.test(key)) continue;

    const floorRank = pekGateFloorRank(props.floor);
    if (floorRankMap[key] == null || floorRank >= floorRankMap[key]) {
      floorRankMap[key] = floorRank;
      gates[key] = [latLng.lat, latLng.lng];
    }
  }

  gateCache = gates;

  const points = Object.values(gates);
  if (points.length > 0) {
    const sumLat = points.reduce((sum, point) => sum + point[0], 0);
    const sumLng = points.reduce((sum, point) => sum + point[1], 0);
    centerCache = { lat: sumLat / points.length, lng: sumLng / points.length };
  }
  if (points.length >= 2) {
    const pad = 0.0005;
    bboxCache = {
      minLat: Math.min(...points.map((point) => point[0])) - pad,
      maxLat: Math.max(...points.map((point) => point[0])) + pad,
      minLng: Math.min(...points.map((point) => point[1])) - pad,
      maxLng: Math.max(...points.map((point) => point[1])) + pad,
    };
  }
}

export async function loadPoiCache(): Promise<void> {
  const base = INDOOR_MAP_API_UPSTREAM.replace(/\/+$/, "");
  if (!base) {
    console.warn("[poiCache] INDOOR_MAP_API_UPSTREAM not set — gate coords unavailable");
    return;
  }
  try {
    const url = `${base}/api/poi?terminal=${encodeURIComponent(DEFAULT_TERMINAL)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { features?: unknown[] };
    ingestFeatures(Array.isArray(data.features) ? data.features : []);
    console.log(`[poiCache] Loaded ${Object.keys(gateCache).length} gates from ${url}`);
  } catch (err) {
    console.warn(`[poiCache] Failed to load POI data: ${err} — gate coords unavailable`);
  }
}

export function getGateCoord(id: string): [number, number] | null {
  return gateCache[normalizePekGate(id)] ?? null;
}

export function getAllGateCoords(): Record<string, [number, number]> {
  return { ...gateCache };
}

export function getPekCenter(): LatLng {
  return { ...centerCache };
}

export function getPekBbox(): Bbox {
  return { ...bboxCache };
}
