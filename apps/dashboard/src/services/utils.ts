import type { LatLng } from "../types/types";

export { haversineMeters } from "../utils/geo";

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) };
}

export function makePolyline(a: LatLng, b: LatLng, segments = 8): LatLng[] {
  const mid = lerpLatLng(a, b, 0.5);
  const dx = (b.lng - a.lng);
  const dy = (b.lat - a.lat);
  const bend = 0.18;
  const mid2 = { lat: mid.lat + dy * bend, lng: mid.lng - dx * bend };
  const pts: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p1 = lerpLatLng(a, mid2, t);
    const p2 = lerpLatLng(mid2, b, t);
    pts.push(lerpLatLng(p1, p2, t));
  }
  return pts;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function randPick<T>(arr: T[], rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}
