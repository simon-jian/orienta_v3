import type { NavAirport } from "./navAirports";

export type NavPoi = {
  id: string;
  name: string;
  category: string;
  terminal: string;
  floor: string;
  lat?: number;
  lon?: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  gate: "登机口 Gate",
  arrival: "到达口",
  departure: "出发口",
  lounge: "休息室",
  security: "安检",
  shop: "商店",
  food: "餐饮",
  toilet: "卫生间",
  elevator: "电梯",
  escalator: "扶梯",
  service: "服务",
  transport: "交通",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category;
}

/** Same contract as pedestrian_dead_reckoning/js/poi-picker.js. */
export async function fetchAirportPois(apiBase: string, airport: NavAirport): Promise<NavPoi[]> {
  if (!apiBase) return [];
  const terminals = airport.terminals || [];
  const results = await Promise.all(
    terminals.map((term) =>
      fetch(`${apiBase}/api/poi?terminal=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .catch(() => ({ features: [] })),
    ),
  );
  const seen = new Set<string>();
  const pois: NavPoi[] = [];
  for (const result of results as Array<{ features?: Array<Record<string, unknown>> }>) {
    for (const f of result.features || []) {
      const p = (f.properties || {}) as Record<string, unknown>;
      if (p.category === "waypoint" || p.id == null) continue;
      const id = String(p.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const geom = f.geometry as { coordinates?: number[] } | undefined;
      const coords = geom?.coordinates || [];
      pois.push({
        id,
        name: String(p.name || p.name_en || `POI #${id}`),
        category: String(p.category || "other"),
        terminal: String(p.terminal || ""),
        floor: String(p.floor || ""),
        lat: typeof p.lat === "number" ? p.lat : typeof coords[1] === "number" ? coords[1] : undefined,
        lon: typeof p.lon === "number" ? p.lon : typeof coords[0] === "number" ? coords[0] : undefined,
      });
    }
  }
  pois.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return pois;
}

function normalizeGateToken(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^GATE\s+/i, "")
    .replace(/\s+/g, "");
}

/** Prefill From/To from flight gate codes (E21, Gate E21, …). */
export function matchPoiByGateHint(pois: NavPoi[], gateHint: string | undefined | null): NavPoi | null {
  const hint = normalizeGateToken(gateHint || "");
  if (!hint || hint === "—" || hint === "-") return null;
  const gates = pois.filter((p) => /gate|arrival|departure/i.test(p.category));
  const pool = gates.length ? gates : pois;
  const exact = pool.find((p) => normalizeGateToken(p.name) === hint);
  if (exact) return exact;
  return pool.find((p) => normalizeGateToken(p.name).includes(hint) || hint.includes(normalizeGateToken(p.name))) || null;
}
