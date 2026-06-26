/**
 * Shared PEK T3E POI parsing for indoor-map gate features.
 */
import type { LatLng } from "../types/types";

export function normalizePekGate(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^GATE_/, "");
}

export function extractPekGateKey(props: Record<string, unknown>): string {
  const candidates = [props.gate, props.code, props.name, props.name_en, props.id].filter(
    (value) => value != null && String(value).trim(),
  );
  for (const candidate of candidates) {
    const text = String(candidate).toUpperCase();
    const match = /\b(?:GATE\s*)?(E\s*0?\d{1,2})\b/.exec(text);
    if (match) return normalizePekGate(match[1]);
  }
  return "";
}

export function isPekGateCategory(category: unknown): boolean {
  const normalized = String(category || "").toLowerCase();
  return normalized === "gate" || normalized === "arrival" || normalized === "departure";
}

export function pekGateFloorRank(floor: unknown): number {
  const normalized = String(floor || "").trim().toUpperCase();
  if (normalized === "L3" || normalized === "F3") return 3;
  if (normalized === "L2" || normalized === "F2") return 2;
  return 1;
}

export function isPekFloorL3(floor: unknown): boolean {
  const normalized = String(floor || "").trim().toUpperCase();
  return normalized === "L3" || normalized === "F3" || !normalized;
}

export function readFeatureLatLng(
  properties: Record<string, unknown>,
  coordinates?: number[],
): LatLng | null {
  const lng = coordinates && Number.isFinite(Number(coordinates[0]))
    ? Number(coordinates[0])
    : Number(properties.lon);
  const lat = coordinates && Number.isFinite(Number(coordinates[1]))
    ? Number(coordinates[1])
    : Number(properties.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lat, lng };
}
