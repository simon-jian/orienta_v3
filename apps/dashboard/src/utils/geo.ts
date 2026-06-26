/**
 * Geographic distance helpers shared by client and server.
 */
import type { LatLng } from "../types/types";

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two WGS84 points in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinHalf =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(sinHalf));
}

/** Indoor walking estimate from lat/lng pairs ([lat, lng]). */
export function estimateWalkingTime(
  from: [number, number],
  to: [number, number],
  walkSpeedMetersPerSecond = 1.25,
  detourFactor = 1.35,
): { meters: number; minutes: number } {
  const meters = Math.round(
    haversineMeters({ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }) * detourFactor,
  );
  return {
    meters,
    minutes: Math.round(meters / walkSpeedMetersPerSecond / 60),
  };
}
