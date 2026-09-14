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

type GateToken = { prefix: string; number: number; suffix: string };

/**
 * Gate codes as a comparable shape, so zero padding and any descriptive text
 * around them stop mattering: the map publishes SFO gates as "G08 登机口"
 * while a flight reports gate "G8", and comparing the strings (whole or as
 * substrings) matched neither — the destination was left unselected even
 * though the gate was known.
 */
function gateTokensIn(value: string): GateToken[] {
  const token = normalizeGateToken(value);
  const out: GateToken[] = [];
  const pattern = /([A-Z]*)(\d{1,4})([A-Z]?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(token)) !== null) {
    out.push({ prefix: match[1] ?? "", number: Number(match[2]), suffix: match[3] ?? "" });
  }
  return out;
}

function sameGate(a: GateToken, b: GateToken): boolean {
  return a.prefix === b.prefix && a.number === b.number && a.suffix === b.suffix;
}

function rankGatePool(pois: NavPoi[], preferCategory?: string): NavPoi[] {
  if (!preferCategory) return pois;
  return [...pois].sort((a, b) =>
    Number(b.category.toLowerCase() === preferCategory.toLowerCase()) -
    Number(a.category.toLowerCase() === preferCategory.toLowerCase()),
  );
}

/** Prefill From/To from flight gate codes (E21, Gate E21, G8 ↔ "G08 登机口", …). */
export function matchPoiByGateHint(
  pois: NavPoi[],
  gateHint: string | undefined | null,
  opts?: { preferCategory?: string },
): NavPoi | null {
  const hint = normalizeGateToken(gateHint || "");
  if (!hint || hint === "—" || hint === "-") return null;
  const gates = pois.filter((p) => /gate|arrival|departure/i.test(p.category));
  const pool = rankGatePool(gates.length ? gates : pois, opts?.preferCategory);

  const exact = pool.find((p) => normalizeGateToken(p.name) === hint);
  if (exact) return exact;

  // Only compare structurally when the hint itself looks like a gate code,
  // so a hint of "8" can't claim G8 over C8.
  const hintTokens = gateTokensIn(hint).filter((t) => t.prefix !== "");
  const hintToken = hintTokens.length === 1 ? hintTokens[0]! : null;
  if (hintToken) {
    const structural = pool.find((p) => gateTokensIn(p.name).some((t) => sameGate(t, hintToken)));
    if (structural) return structural;
  }

  // A digits-only hint cannot say which concourse it belongs to, and loose
  // substring matching would happily pick "C08" for "8". Leaving the field
  // empty for the passenger to choose beats prefilling the wrong gate.
  if (/^\d+$/.test(hint)) return null;

  return pool.find((p) => normalizeGateToken(p.name).includes(hint) || hint.includes(normalizeGateToken(p.name))) || null;
}

function sameToken(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** Security checkpoint closest to a known gate (same terminal/floor first). */
export function matchSecurityPoi(pois: NavPoi[], near?: NavPoi | null): NavPoi | null {
  const list = pois.filter((p) => p.category.toLowerCase() === "security");
  if (!list.length) return null;
  if (!near) return list[0] ?? null;
  const sameTermFloor = list.find((p) => sameToken(p.terminal, near.terminal) && sameToken(p.floor, near.floor));
  if (sameTermFloor) return sameTermFloor;
  const sameTerm = list.find((p) => sameToken(p.terminal, near.terminal));
  if (sameTerm) return sameTerm;
  const sameFloor = list.find((p) => sameToken(p.floor, near.floor));
  return sameFloor ?? list[0] ?? null;
}

export function isPekAirport(code?: string | null): boolean {
  return String(code || "").trim().toUpperCase() === "PEK";
}

/** PEK departure landside start: 安检1 on T3E L2. */
export function matchPekAnjian1(pois: NavPoi[]): NavPoi | null {
  const list = pois.filter((p) => p.category.toLowerCase() === "security");
  const exact = list.find((p) => p.name.replace(/\s+/g, "") === "安检1");
  if (exact) return exact;
  return list.find((p) => sameToken(p.terminal, "T3E") && sameToken(p.floor, "L2")) ?? null;
}

/**
 * Departure walk: destination = assigned gate, origin = security.
 * PEK departures always start at 安检1 (L2). A real two-ended transfer keeps
 * both gate hints and does not force 安检.
 */
export function applyNavPlanPrefill(
  pois: NavPoi[],
  hints: { fromGateHint?: string; toGateHint?: string; airport?: string },
): { fromId: string; toId: string } {
  const to = matchPoiByGateHint(pois, hints.toGateHint, { preferCategory: "gate" });
  const fromExplicit = matchPoiByGateHint(pois, hints.fromGateHint);
  const toId = to?.id || "";
  const transfer =
    !!fromExplicit &&
    !!to &&
    fromExplicit.id !== to.id &&
    !!hints.fromGateHint &&
    !!hints.toGateHint &&
    hints.fromGateHint !== hints.toGateHint;

  if (isPekAirport(hints.airport) && !transfer) {
    const anjian1 = matchPekAnjian1(pois);
    const fromId = anjian1 && anjian1.id !== toId ? anjian1.id : "";
    return { fromId, toId };
  }

  if (fromExplicit && fromExplicit.id !== to?.id) {
    return { fromId: fromExplicit.id, toId };
  }
  if (to) {
    const security = matchSecurityPoi(pois, to);
    if (security && security.id !== to.id) return { fromId: security.id, toId };
  }
  return { fromId: "", toId };
}
