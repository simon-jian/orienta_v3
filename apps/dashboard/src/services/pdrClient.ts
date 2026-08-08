import { apiUrl } from "../config/api";

export type PdrTrajectoryUpdate = {
  position: { lat: number; lng: number };
  path: { lat: number; lng: number }[];
  headingRad?: number | null;
};

/** A pre-planned route (≥2 points) for the PDR backend to follow — see that
 * repo's backend/README.md. No free-walk mode: a session can't start without
 * one. Typically sourced from the embedded indoor map's own gate-to-gate
 * routing (`orienta-nav-path-lonlat`) — see PaxAppPage.tsx. */
export type PdrPlannedPath = { lat: number; lng: number }[];

declare global {
  interface Window {
    __ORIENTA_PDR__?: { active?: boolean; hasPlannedRoute?: () => boolean; reset?: () => boolean };
    __ORIENTA_PDR_PLANNED_PATH__?: PdrPlannedPath;
    __ORIENTA_PDR_PASSENGER_ID__?: string;
    __ORIENTA_PDR_ON_TRAJECTORY__?: (
      lng: number,
      lat: number,
      path: { lat: number; lng: number }[],
      headingRad?: number | null,
    ) => void;
    __ORIENTA_PDR_ON_STATUS__?: (msg: string) => void;
    __ORIENTA_PDR_POST_TO_MAP__?: (
      lng: number,
      lat: number,
      path: { lat: number; lng: number }[],
      headingRad?: number | null,
    ) => void;
    __ORIENTA_PDR_START__?: () => Promise<void>;
    __ORIENTA_PDR_STOP__?: () => void;
    __ORIENTA_PDR_TOGGLE__?: () => void;
    __ORIENTA_PDR_IS_ACTIVE__?: () => boolean;
    __ORIENTA_PDR_HAS_ROUTE__?: () => boolean;
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadPdrClientScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.__ORIENTA_PDR_START__) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-orienta-pdr-client="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("pdr_script_load_failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = apiUrl("/orienta-pdr-client.js");
    script.async = true;
    script.dataset.orientaPdrClient = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("pdr_script_load_failed"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function checkPdrBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/pdr-api/health"), { method: "GET" });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function configurePdrSession(opts: {
  passengerId: string;
  onTrajectory: (update: PdrTrajectoryUpdate) => void;
  onStatus?: (msg: string) => void;
  postToMap?: (update: PdrTrajectoryUpdate) => void;
}): Promise<void> {
  await loadPdrClientScript();
  window.__ORIENTA_PDR_PASSENGER_ID__ = opts.passengerId;
  window.__ORIENTA_PDR_ON_TRAJECTORY__ = (lng, lat, path, headingRad) => {
    opts.onTrajectory({ position: { lat, lng }, path, headingRad });
  };
  window.__ORIENTA_PDR_ON_STATUS__ = (msg) => {
    opts.onStatus?.(msg);
  };
  if (opts.postToMap) {
    window.__ORIENTA_PDR_POST_TO_MAP__ = (lng, lat, path, headingRad) => {
      opts.postToMap?.({ position: { lat, lng }, path, headingRad });
    };
  } else {
    delete window.__ORIENTA_PDR_POST_TO_MAP__;
  }
}

export async function startPdrSession(): Promise<void> {
  await loadPdrClientScript();
  if (!window.__ORIENTA_PDR_START__) throw new Error("pdr_not_loaded");
  await window.__ORIENTA_PDR_START__();
}

export function stopPdrSession(): void {
  window.__ORIENTA_PDR_STOP__?.();
}

export function isPdrSessionActive(): boolean {
  return !!window.__ORIENTA_PDR_IS_ACTIVE__?.() || !!window.__ORIENTA_PDR__?.active;
}

/** Feeds the client a route to follow (≥2 points) before starting — see
 * `PdrPlannedPath`. Pass `null` to clear it (e.g. once the map's own
 * gateFrom/gateTo route becomes stale). */
export function setPdrPlannedPath(path: PdrPlannedPath | null): void {
  if (path && path.length >= 2) window.__ORIENTA_PDR_PLANNED_PATH__ = path;
  else delete window.__ORIENTA_PDR_PLANNED_PATH__;
}

/** Whether a planned route is currently available to start a session with —
 * either fed via setPdrPlannedPath() or already resolved by the client
 * itself (e.g. the passenger map's gate-to-gate route). Requires the client script
 * to be loaded first (see loadPdrClientScript/configurePdrSession). */
export function hasPdrPlannedRoute(): boolean {
  return !!window.__ORIENTA_PDR_HAS_ROUTE__?.();
}
