import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Gate, PassengerComputed, LatLng } from "../../types/types";
import { getCenter as getPoiCenter } from "../../services/poi/PoiService";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../config/indoorMap";
import { clientDefaultAirportId, clientDefaultTenantId } from "../../config/client";
import LeafletAdapter from "./leafletAdapter";

function statusColor(p: PassengerComputed) {
  const es = p.extStatus;
  if (es === "missed") return "#8e8e93";
  if (es === "offline") return "#636366";
  if (es === "lost") return "#ff9f0a";
  if (p.status === "green") return "#34c759";
  if (p.status === "yellow") return "#ffcc00";
  if (p.status === "red") return "#ff3b30";
  return "#8e8e93";
}

export type DashboardMapViewProps = {
  gates: Gate[];
  passengers: PassengerComputed[];
  selectedGateId?: string | null;
  selectedPassengerId: string | null;
  onSelectGate?(id: string): void;
  onSelectPassenger(id: string): void;
  onHoverPassenger?(id: string | null): void;
  visible?: boolean;
  centerOverride?: LatLng;
  /** Airport id (e.g. "PEK"). Defaults to the build's CLIENT_DEFAULT_AIRPORT. */
  airport?: string;
  /** Defaults to the build's CLIENT_DEFAULT_TENANT. */
  tenantId?: string;
};

/**
 * Admin map: same base URL as passenger `routeSite` (HTTPS + same Tailscale host recommended).
 * Posts `orienta-admin-trajectories` into the iframe so your `airport-map.html` can draw live pax (optional).
 */
function postToMapIframe(
  win: Window | null | undefined,
  targetOrigin: string,
  payload: Record<string, unknown>,
): void {
  if (!win || !targetOrigin) return;
  try {
    win.postMessage(payload, targetOrigin);
  } catch {
    /* ignore */
  }
}

function IndoorMapEmbed(props: {
  baseUrl: string;
  airport: string;
  tenantId: string;
  passengers: PassengerComputed[];
  selectedPassengerId: string | null;
  visible?: boolean;
}) {
  const { baseUrl, airport, tenantId, passengers, selectedPassengerId, visible } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapTabShownRef = useRef(false);

  const iframeSrc = useMemo(() => {
    const u = new URL(baseUrl, typeof window !== "undefined" ? window.location.href : "http://localhost");
    u.searchParams.set("airport", airport);
    u.searchParams.set("tenant", tenantId);
    u.searchParams.set("mapRole", "operator");
    const apiBase = INDOOR_MAP_API_BASE;
    if (apiBase) u.searchParams.set("apiBase", apiBase);
    return u.toString();
  }, [baseUrl, airport, tenantId]);

  const targetOrigin = useMemo(() => {
    try {
      return new URL(iframeSrc).origin;
    } catch {
      return typeof window !== "undefined" ? window.location.origin : "";
    }
  }, [iframeSrc]);

  const pushTrajectories = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !targetOrigin) return;
    postToMapIframe(win, targetOrigin, {
      type: "orienta-admin-trajectories",
      airport,
      tenantId,
      selectedPassengerId,
      passengers: passengers.map((p) => ({
        id: p.id,
        position: p.location,
        path:
          Array.isArray(p.path) && p.path.length > 0
            ? p.path
            : p.location
              ? [{ lat: p.location.lat, lng: p.location.lng }]
              : [],
        color: statusColor(p),
        extStatus: p.extStatus,
        status: p.status,
      })),
    });
  }, [airport, tenantId, selectedPassengerId, passengers, targetOrigin]);

  useEffect(() => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      pushTrajectories();
    }, 120);
    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [pushTrajectories]);

  useEffect(() => {
    if (!visible) {
      mapTabShownRef.current = false;
      return;
    }
    const justShown = !mapTabShownRef.current;
    mapTabShownRef.current = true;
    if (!justShown) return;
    pushTrajectories();
    const win = iframeRef.current?.contentWindow;
    postToMapIframe(win, targetOrigin, { type: "orienta-map-invalidate" });
    const tid = window.setTimeout(() => {
      postToMapIframe(iframeRef.current?.contentWindow, targetOrigin, { type: "orienta-map-invalidate" });
    }, 150);
    return () => clearTimeout(tid);
  }, [visible, pushTrajectories, targetOrigin]);

  return (
    <div className="orienta-map-frame" style={{ width: "100%", height: "100%", minHeight: 0, position: "relative" }}>
      <iframe
        ref={iframeRef}
        title="Indoor map"
        src={iframeSrc}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#111", zIndex: 1 }}
        onLoad={pushTrajectories}
      />
    </div>
  );
}

function StandardMapView(props: DashboardMapViewProps) {
  const { gates, passengers, selectedGateId = null, selectedPassengerId, onSelectGate = () => {}, onSelectPassenger } = props;

  const center = props.centerOverride ?? getPoiCenter(props.airport);
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<LeafletAdapter | null>(null);

  const tracks = useMemo(
    () =>
      passengers
        .filter((p) => p.activity === "moving" && p.path && p.path.length > 1)
        .map((p) => ({
          id: `trk_${p.id}`,
          passengerId: p.id,
          points: p.path!,
          color: statusColor(p),
        })),
    [passengers]
  );

  const staticRoutes = useMemo(() => [], []);

  const payload = useMemo(
    () => ({ center, gates, passengers, tracks, staticRoutes, selectedGateId, selectedPassengerId }),
    [center, gates, passengers, tracks, staticRoutes, selectedGateId, selectedPassengerId]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    const container = containerRef.current;
    if ((container as any)._leaflet_id) delete (container as any)._leaflet_id;

    LeafletAdapter.create(container, {
      initialCenter: center,
      onSelectGate,
      onSelectPassenger,
      onHoverPassenger: props.onHoverPassenger ?? (() => {}),
    }).then((adapter) => {
      if (destroyed) { adapter.destroy(); return; }
      adapterRef.current = adapter;
      adapter.setData(payload);
    });

    return () => {
      destroyed = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [center.lat, center.lng]); // eslint-disable-line

  useEffect(() => {
    adapterRef.current?.setData(payload);
  }, [payload]);

  const mapTabWasVisibleRef = useRef(false);
  useEffect(() => {
    if (!props.visible) { mapTabWasVisibleRef.current = false; return; }
    const justShown = !mapTabWasVisibleRef.current;
    mapTabWasVisibleRef.current = true;
    if (!justShown) return;
    const runInv = () => adapterRef.current?.invalidate();
    runInv();
    const tid = window.setTimeout(runInv, 120);
    return () => clearTimeout(tid);
  }, [props.visible]);

  return (
    <div className="orienta-map-frame" style={{ width: "100%", height: "100%", minHeight: 0, position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 0 }} />
    </div>
  );
}

export default function MapView(props: DashboardMapViewProps) {
  const indoor = INDOOR_MAP_URL;
  const airport = props.airport ?? clientDefaultAirportId();
  const tenantId = props.tenantId ?? clientDefaultTenantId();

  if (indoor) {
    return (
      <IndoorMapEmbed
        baseUrl={indoor}
        airport={airport}
        tenantId={tenantId}
        passengers={props.passengers}
        selectedPassengerId={props.selectedPassengerId}
        visible={props.visible}
      />
    );
  }

  return <StandardMapView {...props} />;
}
