/**
 * Trajectory sub-module — live PDR path from pax device → admin map.
 *
 * Extracted from the monolithic wsHub.ts.
 */
import { HubStore } from "./HubStore";

function normalizeTrajectoryPath(
  raw: unknown[]
): { lat: number; lng: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: unknown) => {
      const point = p as Record<string, unknown>;
      return { lat: Number(point.lat), lng: Number(point.lng) };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
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
