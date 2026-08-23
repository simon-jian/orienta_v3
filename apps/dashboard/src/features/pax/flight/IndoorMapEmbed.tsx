import { useEffect, useMemo, useRef } from "react";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../../config/indoorMap";
import { clientDefaultAirportId } from "../../../config/client";
import type { PaxSession } from "../session";
import { buildStartNavHref, gateHintsForLeg, prepareStartNavigation } from "../assist/navPlan";

export type MapLeg = "dep" | "arr";

type Props = {
  session: PaxSession;
  gateFrom?: string;
  gateTo?: string;
  airport?: string;
  /** Labels for the dep/arr map toggle (IATA). */
  depAirportLabel?: string;
  arrAirportLabel?: string;
  /** @deprecated Prefer flight-derived href from gates; kept for overrides. */
  startNavTo?: string;
  mapLeg?: MapLeg;
  onMapLegChange?: (leg: MapLeg) => void;
  showLegToggle?: boolean;
};

function usableGate(value: string | undefined): string {
  const g = (value || "").trim();
  if (!g || g === "—") return "";
  return g;
}

function usableAirport(value: string | undefined | null): string {
  const c = String(value || "")
    .trim()
    .toUpperCase();
  if (!c || c === "—" || c === "-") return "";
  return c;
}

export function IndoorMapEmbed({
  session,
  gateFrom,
  gateTo,
  airport,
  depAirportLabel,
  arrAirportLabel,
  startNavTo,
  mapLeg = "dep",
  onMapLegChange,
  showLegToggle = false,
}: Props) {
  const from = usableGate(gateFrom) || usableGate(session.passenger.gateId);
  const to = usableGate(gateTo) || from;
  const airportCode = usableAirport(airport) || clientDefaultAirportId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const src = useMemo(() => {
    const u = new URL(INDOOR_MAP_URL, window.location.origin);
    u.searchParams.set("airport", airportCode);
    u.searchParams.set("tenant", session.passenger.tenantId);
    u.searchParams.set("mapRole", "passenger");
    u.searchParams.set("apiBase", INDOOR_MAP_API_BASE);
    if (from) u.searchParams.set("gateFrom", from);
    if (to) u.searchParams.set("gateTo", to);
    u.searchParams.set("dep", session.passenger.flightId || "");
    u.searchParams.set("pax", session.passenger.id);
    u.searchParams.set("parentOrigin", window.location.origin);
    // Bust cache when airport/gates change so the map re-inits.
    u.searchParams.set("_v", `${airportCode}-${from}-${to}`);
    return u.toString();
  }, [airportCode, from, to, session.passenger.tenantId, session.passenger.flightId, session.passenger.id]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const applyAirport = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      let origin = window.location.origin;
      try {
        origin = new URL(iframe.src || INDOOR_MAP_URL, window.location.href).origin;
      } catch {
        /* ignore */
      }
      win.postMessage({ type: "orienta-indoor-set-airport", airport: airportCode }, origin);
    };

    const onLoad = () => {
      // Map attaches its listener asynchronously; retry a couple times.
      applyAirport();
      window.setTimeout(applyAirport, 200);
      window.setTimeout(applyAirport, 800);
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [src, airportCode]);

  const hints = {
    airport: airportCode,
    ...gateHintsForLeg(from, to, mapLeg),
    flightId: session.passenger.flightId,
  };

  return (
    <div className="pax-map-shell">
      {showLegToggle && onMapLegChange ? (
        <div className="pax-map-controls-left" role="group" aria-label="Map leg">
          <div className="pax-map-seg">
            <button
              type="button"
              className={`pax-map-control${mapLeg === "dep" ? " active" : ""}`}
              aria-pressed={mapLeg === "dep"}
              onClick={() => onMapLegChange("dep")}
            >
              出发地图{depAirportLabel ? ` · ${depAirportLabel}` : ""}
            </button>
            <button
              type="button"
              className={`pax-map-control${mapLeg === "arr" ? " active" : ""}`}
              aria-pressed={mapLeg === "arr"}
              onClick={() => onMapLegChange("arr")}
            >
              抵达地图{arrAirportLabel ? ` · ${arrAirportLabel}` : ""}
            </button>
          </div>
        </div>
      ) : null}
      <iframe
        key={src}
        ref={iframeRef}
        className="pax-map-frame"
        title={`机场地图 ${airportCode}`}
        src={src}
        allow="geolocation"
      />
      <a
        className="pax-start-nav"
        href={startNavTo || buildStartNavHref(hints)}
        onClick={(e) => {
          if (startNavTo) return;
          e.preventDefault();
          window.location.href = prepareStartNavigation(hints);
        }}
      >
        开始导航
      </a>
    </div>
  );
}
