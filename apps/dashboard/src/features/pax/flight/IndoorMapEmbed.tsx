import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../../config/indoorMap";
import { clientDefaultAirportId } from "../../../config/client";
import type { PaxSession } from "../session";
import { buildStartNavHref, prepareStartNavigation } from "../assist/navPlan";

export type MapLeg = "dep" | "arr";

type Props = {
  session: PaxSession;
  gateFrom?: string;
  gateTo?: string;
  airport?: string;
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

export function IndoorMapEmbed({
  session,
  gateFrom,
  gateTo,
  airport,
  startNavTo,
  mapLeg = "dep",
  onMapLegChange,
  showLegToggle = false,
}: Props) {
  const from = usableGate(gateFrom) || usableGate(session.passenger.gateId);
  const to = usableGate(gateTo) || from;
  const airportCode = airport || clientDefaultAirportId();
  const src = new URL(INDOOR_MAP_URL, window.location.origin);
  src.searchParams.set("airport", airportCode);
  src.searchParams.set("tenant", session.passenger.tenantId);
  src.searchParams.set("mapRole", "passenger");
  src.searchParams.set("apiBase", INDOOR_MAP_API_BASE);
  src.searchParams.set("gateFrom", from);
  src.searchParams.set("gateTo", to);
  src.searchParams.set("dep", session.passenger.flightId || "");
  src.searchParams.set("pax", session.passenger.id);
  src.searchParams.set("parentOrigin", window.location.origin);

  const hints = {
    airport: airportCode,
    fromGateHint: from,
    toGateHint: to,
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
              出发地图
            </button>
            <button
              type="button"
              className={`pax-map-control${mapLeg === "arr" ? " active" : ""}`}
              aria-pressed={mapLeg === "arr"}
              onClick={() => onMapLegChange("arr")}
            >
              抵达地图
            </button>
          </div>
        </div>
      ) : null}
      <iframe className="pax-map-frame" title="机场地图" src={src.toString()} allow="geolocation" />
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
