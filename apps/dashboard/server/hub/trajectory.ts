/**
 * Trajectory sub-module — live PDR path from pax device → admin map.
 *
 * Extracted from the monolithic wsHub.ts.
 */
import { HubStore } from "./HubStore";

/**
 * Caps how many points a single trajectory update can contribute. Without
 * this, a buggy or malicious client could grow one passenger's stored path
 * without bound — it's kept in memory for as long as the passenger stays
 * connected and re-sent in full to every admin socket on every update.
 */
const MAX_TRAJECTORY_POINTS = 500;

function normalizeTrajectoryPath(
  raw: unknown[]
): { lat: number; lng: number }[] {
  if (!Array.isArray(raw)) return [];
  const points = raw
    .map((p: unknown) => {
      const point = p as Record<string, unknown>;
      return { lat: Number(point.lat), lng: Number(point.lng) };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  // Keep the most recent points — older history matters less than a bounded
  // memory/bandwidth footprint for a live "where are they now" trail.
  return points.length > MAX_TRAJECTORY_POINTS
    ? points.slice(points.length - MAX_TRAJECTORY_POINTS)
    : points;
}

export function storeAndBroadcastTrajectory(
  store: HubStore,
  tenantId: string,
  rawPassengerId: string,
  pathRaw: unknown[],
  position: { lat: number; lng: number } | null
): boolean {
  const pid = String(rawPassengerId ?? "").trim();
  if (!pid || !tenantId) return false;

  const prev = store.getTrajectory(tenantId, pid);
  const pathPoints = normalizeTrajectoryPath(pathRaw);
  const path = pathPoints.length > 0 ? pathPoints : (prev?.path ?? []);

  const pos =
    position &&
    Number.isFinite(position.lat) &&
    Number.isFinite(position.lng)
      ? position
      : (prev?.position ?? null);

  if (!pos) return false;

  const data = { path: path.length > 0 ? path : [pos], position: pos };
  store.setTrajectory(tenantId, pid, data);
  store.broadcastAdmins(tenantId, {
    type: "pax_trajectory",
    tenantId,
    passengerId: pid,
    path: data.path,
    position: data.position,
  });
  return true;
}

export function clearStoredTrajectory(
  store: HubStore,
  tenantId: string,
  rawPassengerId: string
): boolean {
  const pid = String(rawPassengerId ?? "").trim();
  if (!pid || !tenantId) return false;
  if (!store.deleteTrajectory(tenantId, pid)) return false;
  store.broadcastAdmins(tenantId, {
    type: "pax_trajectory_clear",
    tenantId,
    passengerId: pid,
  });
  return true;
}
