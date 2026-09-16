import { useEffect, useMemo, useRef } from "react";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../../config/indoorMap";
import { clientDefaultAirportId } from "../../../config/client";
import type { PaxSession } from "../session";
import { usePaxT } from "../i18n";
import { buildStartNavHref, prepareStartNavigation } from "../assist/navPlan";
import { indoorMapFloor, indoorMapGateLabel, usableMapGate } from "./indoorMapParams";

export type MapLeg = "dep" | "arr";

type Props = {
  session: PaxSession;
  gateFrom?: string;
  gateTo?: string;
  airport?: string;
  /** Labels for the dep/arr map toggle (IATA). */
  depAirportLabel?: string;
  arrAirportLabel?: string;
  /** Departure airport + boarding gate for Start navigation (安检 → 登机口). */
  navAirport?: string;
  navGate?: string;
  navFlightId?: string;
  /** @deprecated Prefer flight-derived href from gates; kept for overrides. */
  startNavTo?: string;
  mapLeg?: MapLeg;
  onMapLegChange?: (leg: MapLeg) => void;
  showLegToggle?: boolean;
};


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
  navAirport,
  navGate,
  navFlightId,
  startNavTo,
  mapLeg = "dep",
  onMapLegChange,
  showLegToggle = false,
}: Props) {
  const t = usePaxT();
  const airportCode = usableAirport(airport) || clientDefaultAirportId();
  // Arrival must not fall back to the passenger's outbound boarding gate.
  const rawFrom =
    usableMapGate(gateFrom) ||
    (mapLeg === "dep" && airportCode === clientDefaultAirportId()
      ? usableMapGate(session.passenger.gateId)
      : "");
  const rawTo = usableMapGate(gateTo) || rawFrom;
  const from = indoorMapGateLabel(airportCode, rawFrom, mapLeg);
  const to = indoorMapGateLabel(airportCode, rawTo, mapLeg);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const floor = indoorMapFloor(airportCode, mapLeg);

  const src = useMemo(() => {
    const u = new URL(INDOOR_MAP_URL, window.location.origin);
    u.searchParams.set("airport", airportCode);
    u.searchParams.set("tenant", session.passenger.tenantId);
    u.searchParams.set("mapRole", "passenger");
    u.searchParams.set("apiBase", INDOOR_MAP_API_BASE);
    if (from) u.searchParams.set("gateFrom", from);
    if (to) u.searchParams.set("gateTo", to);
    if (floor) {
      u.searchParams.set("navFloor", floor);
      u.searchParams.set("navFloors", floor);
    }
    u.searchParams.set("dep", session.passenger.flightId || "");
    u.searchParams.set("pax", session.passenger.id);
    u.searchParams.set("parentOrigin", window.location.origin);
    // Bust cache when airport/gates change so the map re-inits.
    u.searchParams.set("_v", `${airportCode}-${from}-${to}-${mapLeg}-${floor || ""}`);
    return u.toString();
  }, [airportCode, from, to, mapLeg, floor, session.passenger.tenantId, session.passenger.flightId, session.passenger.id]);

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
      if (floor) {
        win.postMessage({ type: "orienta-indoor-set-floor", floor }, origin);
      }
    };

    const onLoad = () => {
      // Map attaches its listener asynchronously; retry a couple times.
      applyAirport();
      window.setTimeout(applyAirport, 200);
      window.setTimeout(applyAirport, 800);
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [src, airportCode, floor]);

  const hints = {
    airport: usableAirport(navAirport) || airportCode,
    toGateHint: usableMapGate(navGate),
    flightId: navFlightId || session.passenger.flightId,
  };

  return (
    <div className="pax-map-shell">
      {showLegToggle && onMapLegChange ? (
        <div className="pax-map-controls-left" role="group" aria-label={t("map.legAria")}>
          <div className="pax-map-seg">
            <button
              type="button"
              className={`pax-map-control${mapLeg === "dep" ? " active" : ""}`}
              aria-pressed={mapLeg === "dep"}
              onClick={() => onMapLegChange("dep")}
            >
              {depAirportLabel ? t("map.depAirport", { airport: depAirportLabel }) : t("map.dep")}
            </button>
            <button
              type="button"
              className={`pax-map-control${mapLeg === "arr" ? " active" : ""}`}
              aria-pressed={mapLeg === "arr"}
              onClick={() => onMapLegChange("arr")}
            >
              {arrAirportLabel ? t("map.arrAirport", { airport: arrAirportLabel }) : t("map.arr")}
            </button>
          </div>
        </div>
      ) : null}
      <iframe
        key={src}
        ref={iframeRef}
        className="pax-map-frame"
        title={t("map.iframeTitle", { airport: airportCode })}
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
        {t("map.startNav")}
      </a>
    </div>
  );
}
