import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../../config/indoorMap";
import {
  checkPdrBackendAvailable,
  configurePdrSession,
  isPdrSessionActive,
  setPdrPlannedPath,
  startPdrSession,
  stopPdrSession,
  type PdrTrajectoryUpdate,
} from "../../../services/pdrClient";
import type { PaxRealtime } from "../../../services/realtime";
import type { PaxSession } from "../session";
import { postPaxFallback } from "../assist/postPaxApi";
import { fmtAssistTime } from "../assist/assistTypes";
import { findNavAirport } from "../assist/navAirports";
import type { NavPlanConfirmed } from "../assist/navPlan";

function isLatLng(value: unknown): value is { lat: number; lng: number } {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  return !!v && typeof v.lat === "number" && typeof v.lng === "number";
}

function isLngLatPath(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number")
  );
}

function mapFrameOrigin(src: string): string {
  try {
    return new URL(src, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export function usePdrNavigation(
  session: PaxSession | null,
  realtimeRef: MutableRefObject<PaxRealtime | null>,
  onLocationStatus: (text: string) => void,
  plan: NavPlanConfirmed | null,
) {
  const [navDebug, setNavDebug] = useState("");
  const [pdrStatus, setPdrStatus] = useState("");
  const [pdrActive, setPdrActive] = useState(false);
  const [pdrBackendOk, setPdrBackendOk] = useState<boolean | null>(null);
  const [pdrHasRoute, setPdrHasRoute] = useState(false);
  const [routePlanning, setRoutePlanning] = useState(false);
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lastTrajectoryAtRef = useRef(0);
  const pdrActiveRef = useRef(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  const refreshPdrBackend = useCallback(() => {
    return checkPdrBackendAvailable()
      .then((ok) => {
        setPdrBackendOk(ok);
        return ok;
      })
      .catch(() => {
        setPdrBackendOk(false);
        return false;
      });
  }, []);

  useEffect(() => {
    void refreshPdrBackend();
  }, [refreshPdrBackend]);

  useEffect(() => {
    pdrActiveRef.current = pdrActive;
  }, [pdrActive]);

  function relayTrajectory(activeSession: PaxSession, update: PdrTrajectoryUpdate) {
    const path = update.path.length ? update.path : [update.position];
    realtimeRef.current?.sendTrajectory(path, update.position);
    postPaxFallback(activeSession, "/api/pax/tourist-position", {
      lat: update.position.lat,
      lng: update.position.lng,
      path,
    });
    lastTrajectoryAtRef.current = Date.now();
    setPdrActive(true);
    onLocationStatus(`PDR live · ${fmtAssistTime(Date.now())}`);
  }

  useEffect(() => {
    if (!session) return;

    // #region agent log
    fetch("/api/debug-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "pre-fix", hypothesisId: "D",
        location: "src/features/pax/hooks/usePdrNavigation.ts:92",
        message: "legacy thin PDR client configured (plan is null in embed mode)",
        data: { hasPlan: !!planRef.current, passengerId: session.passenger.id },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    void configurePdrSession({
      passengerId: session.passenger.id,
      onStatus: setPdrStatus,
      onTrajectory: (update) => relayTrajectory(session, update),
      postToMap: (update) => {
        const win = mapFrameRef.current?.contentWindow;
        if (!win || !mapFrameRef.current?.src) return;
        win.postMessage(
          {
            type: "orienta-pax-map-position",
            source: "pdr",
            position: update.position,
            path: update.path,
            headingRad: update.headingRad,
          },
          mapFrameOrigin(mapFrameRef.current.src),
        );
      },
    });

    return () => {
      stopPdrSession();
      setPdrActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per session
  }, [session]);

  const mapSrc = useMemo(() => {
    if (!session || !plan) return "";
    const airport = findNavAirport(plan.airport);
    const u = new URL(INDOOR_MAP_URL, window.location.href);
    u.searchParams.set("airport", plan.airport);
    u.searchParams.set("tenant", session.passenger.tenantId);
    u.searchParams.set("mapRole", "passenger");
    u.searchParams.set("pdrExperimental", "1");
    u.searchParams.set("apiBase", INDOOR_MAP_API_BASE);
    u.searchParams.set("dep", session.passenger.flightId);
    u.searchParams.set("pax", session.passenger.id);
    u.searchParams.set("parentOrigin", window.location.origin);
    if (airport) {
      u.searchParams.set("spawnLat", String(airport.lat));
      u.searchParams.set("spawnLng", String(airport.lng));
    }
    // Cache-bust so plan changes reload the iframe (same as PDR AirportMapEmbed).
    u.searchParams.set("_v", String(plan.confirmedAt));
    return u.toString();
  }, [session, plan]);

  // After map loads: set airport + ask map Dijkstra for from→to (PDR planRoute).
  useEffect(() => {
    if (!session || !plan || !mapSrc) return;
    const iframe = mapFrameRef.current;
    if (!iframe) return;

    let cancelled = false;
    let timer: number | null = null;

    const requestRoute = () => {
      const win = mapFrameRef.current?.contentWindow;
      if (!win || cancelled) return;
      const origin = mapFrameOrigin(mapSrc);
      const active = planRef.current;
      if (!active) return;

      setRoutePlanning(true);
      setPdrHasRoute(false);
      setPdrPlannedPath(null);
      setNavDebug(`规划路线：${active.fromLabel} → ${active.toLabel}`);

      win.postMessage({ type: "orienta-indoor-set-airport", airport: active.airport }, origin);
      win.postMessage(
        {
          type: "orienta-pax-plan-route",
          fromPoiId: Number(active.fromPoiId) || active.fromPoiId,
          toPoiId: Number(active.toPoiId) || active.toPoiId,
          terminals: active.terminals,
        },
        origin,
      );

      timer = window.setTimeout(() => {
        if (cancelled) return;
        setRoutePlanning(false);
        setNavDebug((d) => (d.startsWith("路线已就绪") ? d : "地图未返回路线，请重试或换起终点"));
      }, 12_000);
    };

    const onLoad = () => {
      // Give the map a beat to attach its message listener (same race PDR notes).
      window.setTimeout(requestRoute, 250);
    };

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") onLoad();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      if (timer) window.clearTimeout(timer);
    };
  }, [session, plan, mapSrc]);

  useEffect(() => {
    if (!session) return;
    const activeSession = session;

    function handleMapMessage(ev: MessageEvent) {
      if (ev.source !== mapFrameRef.current?.contentWindow) return;
      const data = ev.data as {
        type?: string;
        ok?: boolean;
        reason?: string;
        position?: unknown;
        path?: unknown;
        pathSteps?: unknown;
        distanceM?: number;
      } | null;
      if (!data) return;

      if (data.type === "orienta-pax-route-result") {
        setRoutePlanning(false);
        if (data.ok && isLngLatPath(data.path)) {
          setPdrPlannedPath(data.path.map(([lng, lat]) => ({ lat, lng })));
          setPdrHasRoute(true);
          const dist =
            typeof data.distanceM === "number" && Number.isFinite(data.distanceM)
              ? ` · ${Math.round(data.distanceM)} m`
              : "";
          const steps = Array.isArray(data.pathSteps) ? data.pathSteps.length : 0;
          setNavDebug(`路线已就绪${dist}${steps ? ` · ${steps} 步` : ""}`);
          setPdrStatus("");
        } else {
          setPdrHasRoute(false);
          setPdrPlannedPath(null);
          const reason = data.reason || "route_failed";
          setNavDebug(`路线规划失败：${reason}`);
          setPdrStatus("No walkable path — pick different From/To");
        }
        return;
      }

      if (data.type === "orienta-nav-path-debug") {
        const steps = Array.isArray(data.pathSteps) ? data.pathSteps.length : 0;
        setNavDebug(`${steps} route steps loaded`);
        return;
      }

      if (data.type === "orienta-nav-path-lonlat") {
        if (isLngLatPath(data.path) && !pdrActiveRef.current && !isPdrSessionActive()) {
          setPdrPlannedPath(data.path.map(([lng, lat]) => ({ lat, lng })));
          setPdrHasRoute(true);
          setRoutePlanning(false);
        }
        return;
      }

      if (data.type !== "orienta-pax-trajectory" || !isLatLng(data.position)) return;
      if (pdrActiveRef.current || isPdrSessionActive()) return;
      // #region agent log
      fetch("/api/debug-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "pre-fix", hypothesisId: "D",
          location: "src/features/pax/hooks/usePdrNavigation.ts:248",
          message: "legacy path pushed a position (second source)",
          data: { hasPlan: !!planRef.current, pathLen: Array.isArray(data.path) ? data.path.length : 0 },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const pathRaw = Array.isArray(data.path) ? data.path : [];
      const path = pathRaw.filter(isLatLng);
      const position = data.position;
      realtimeRef.current?.sendTrajectory(path.length ? path : [position], position);
      postPaxFallback(activeSession, "/api/pax/tourist-position", {
        lat: position.lat,
        lng: position.lng,
        path: path.length ? path : [position],
      });
      lastTrajectoryAtRef.current = Date.now();
      onLocationStatus(`Live position shared at ${fmtAssistTime(Date.now())}.`);
    }

    const pullTimer = window.setInterval(() => {
      if (pdrActiveRef.current || isPdrSessionActive()) return;
      if (Date.now() - lastTrajectoryAtRef.current < 1000) return;
      const w = mapFrameRef.current?.contentWindow as
        | (Window & {
            orientaDumpTouristPosition?: () => unknown;
            orientaGetTouristPositionHistory?: () => unknown;
          })
        | undefined;
      if (!w || typeof w.orientaDumpTouristPosition !== "function") return;
      try {
        const position = w.orientaDumpTouristPosition();
        if (!isLatLng(position)) return;
        const history =
          typeof w.orientaGetTouristPositionHistory === "function"
            ? w.orientaGetTouristPositionHistory()
            : null;
        const path = Array.isArray(history) ? history.filter(isLatLng).slice(-40) : [];
        realtimeRef.current?.sendTrajectory(path.length ? path : [position], position);
        postPaxFallback(activeSession, "/api/pax/tourist-position", {
          lat: position.lat,
          lng: position.lng,
          path: path.length ? path : [position],
        });
        lastTrajectoryAtRef.current = Date.now();
      } catch {
        /* ignore */
      }
    }, 1000);

    window.addEventListener("message", handleMapMessage);
    return () => {
      window.removeEventListener("message", handleMapMessage);
      window.clearInterval(pullTimer);
    };
  }, [session, realtimeRef, onLocationStatus]);

  async function togglePdr() {
    if (isPdrSessionActive()) {
      stopPdrSession();
      setPdrActive(false);
      setPdrStatus("");
      return;
    }
    if (pdrBackendOk === false) {
      setPdrStatus("PDR backend unavailable — set PDR_API_ORIGIN (see README)");
      return;
    }
    if (!pdrHasRoute) {
      setPdrStatus("No route yet — confirm From/To and wait for the map path");
      return;
    }
    try {
      await startPdrSession();
      setPdrActive(isPdrSessionActive());
    } catch (err) {
      setPdrStatus(err instanceof Error ? err.message : "pdr_start_failed");
    }
  }

  function stop() {
    stopPdrSession();
    setPdrActive(false);
  }

  return {
    mapFrameRef,
    mapSrc,
    navDebug,
    pdrStatus,
    pdrActive,
    pdrBackendOk,
    pdrHasRoute,
    routePlanning,
    togglePdr,
    stop,
    refreshPdrBackend,
  };
}
