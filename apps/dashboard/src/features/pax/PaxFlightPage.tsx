import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  clearPaxSession,
  fetchPaxSession,
  getStoredPaxSession,
  getStoredPaxTrip,
  localCalendarDate,
  type PaxSession,
  type PaxTripContext,
} from "./session";
import { fetchClosestFlight, fetchTransfer, type FlightInstance, type TransferResult } from "./api/flightApi";
import { fetchAirportWeather, type AirportWeather } from "./api/weatherApi";
import { IndoorMapEmbed, type MapLeg } from "./flight/IndoorMapEmbed";
import { FlightCard, placeholderFlight } from "./flight/FlightCard";
import { JourneySheets } from "./flight/JourneySheets";
import { clientDefaultAirportId } from "../../config/client";
import "./styles/pax.css";

type SheetKind = "gate" | "exit" | null;

function resolveTrip(session: PaxSession): PaxTripContext {
  const stored = session.trip || getStoredPaxTrip();
  if (stored) return stored;
  return {
    intent: "depart",
    flight: session.passenger.flightId,
    date: localCalendarDate(),
    departureFlight: session.passenger.flightId,
  };
}

function usableGate(value: string | undefined | null): string {
  const g = (value || "").trim();
  if (!g || g === "—") return "";
  return g;
}

export default function PaxFlightPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<PaxSession | null>(() => getStoredPaxSession());
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingFlight, setLoadingFlight] = useState(false);
  const [instance, setInstance] = useState<FlightInstance | null>(null);
  const [badge, setBadge] = useState("");
  const [transfer, setTransfer] = useState<TransferResult | null>(null);
  const [activeLeg, setActiveLeg] = useState<"arr" | "dep">("dep");
  const [mapLeg, setMapLeg] = useState<MapLeg>("dep");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [weather, setWeather] = useState<AirportWeather | null>(null);

  const trip = useMemo(() => (session ? resolveTrip(session) : null), [session]);

  useEffect(() => {
    let cancelled = false;
    const stored = getStoredPaxSession();
    if (!stored?.token) {
      setChecking(false);
      setError("missing_session");
      return;
    }
    fetchPaxSession(stored.token)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "session_invalid");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || !trip) return;
    let cancelled = false;
    setLoadingFlight(true);
    setLoadError("");

    (async () => {
      try {
        if (trip.intent === "transfer") {
          const arr = trip.arrivalFlight || "";
          const dep = trip.departureFlight || session.passenger.flightId;
          if (!arr || !dep) throw new Error("missing_transfer_flights");
          const data = await fetchTransfer(arr, dep);
          if (cancelled) return;
          setTransfer(data);
          setActiveLeg("arr");
          setMapLeg("arr");
          setInstance(data.arrival);
          setBadge("ARRIVAL");
        } else {
          const flight = trip.flight || session.passenger.flightId;
          const date = trip.date || localCalendarDate();
          const data = await fetchClosestFlight(flight, date, trip.intent);
          if (cancelled) return;
          setTransfer(null);
          setInstance(data.instance);
          setBadge(data.badge?.label || data.instance.status || "SCHEDULED");
          const leg = trip.intent === "arrive" ? "arr" : "dep";
          setActiveLeg(leg);
          setMapLeg(leg);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "flight_load_failed");
      } finally {
        if (!cancelled) setLoadingFlight(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, trip]);

  const liveInstance =
    trip?.intent === "transfer" && transfer
      ? activeLeg === "arr"
        ? transfer.arrival
        : transfer.departure
      : instance;

  useEffect(() => {
    const code = liveInstance?.arr_iata || liveInstance?.arr_airport_code || "";
    if (!code || code === "—") {
      setWeather(null);
      return;
    }
    let cancelled = false;
    fetchAirportWeather(code).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => {
      cancelled = true;
    };
  }, [liveInstance?.arr_iata, liveInstance?.arr_airport_code]);

  if (checking) {
    return (
      <div className="pax-shell">
        <div className="pax-wrap">Loading…</div>
      </div>
    );
  }

  if (!session || error || !trip) {
    return (
      <div className="pax-shell">
        <div className="pax-wrap">
          <p className="pax-error">{error || "missing_session"}</p>
          <Link className="pax-btn" to="/pax/login" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            去登录
          </Link>
        </div>
      </div>
    );
  }

  const displayInstance =
    liveInstance ||
    placeholderFlight(
      trip.intent === "transfer"
        ? activeLeg === "arr"
          ? trip.arrivalFlight || session.passenger.flightId
          : trip.departureFlight || session.passenger.flightId
        : trip.flight || session.passenger.flightId,
      session.passenger.gateId,
    );
  const flightNotice = loadError
    ? "实时航班数据暂不可用。仍可使用 Time to Gate / Exit 与地图导航。"
    : undefined;

  const gateFlight =
    trip.intent === "transfer"
      ? trip.departureFlight || session.passenger.flightId
      : trip.flight || session.passenger.flightId;
  const exitFlight =
    trip.intent === "transfer"
      ? trip.arrivalFlight || session.passenger.flightId
      : trip.flight || session.passenger.flightId;
  const gateDate =
    trip.intent === "transfer" ? trip.departureDate || localCalendarDate() : trip.date || localCalendarDate();
  const exitDate =
    trip.intent === "transfer" ? trip.arrivalDate || localCalendarDate() : trip.date || localCalendarDate();

  const depGate = usableGate(displayInstance.dep_gate) || usableGate(session.passenger.gateId);
  const arrGate = usableGate(displayInstance.arr_gate);
  const mapAirport =
    trip.intent === "transfer"
      ? transfer?.hub_airport || clientDefaultAirportId()
      : mapLeg === "arr"
        ? displayInstance.arr_iata || clientDefaultAirportId()
        : displayInstance.dep_iata || clientDefaultAirportId();
  const mapFrom =
    trip.intent === "transfer"
      ? transfer?.from_gate
      : mapLeg === "arr"
        ? arrGate
        : depGate;
  const mapTo =
    trip.intent === "transfer"
      ? mapLeg === "arr"
        ? transfer?.from_gate
        : transfer?.to_gate
      : mapLeg === "arr"
        ? arrGate
        : depGate;

  const gateSubtitle = `${displayInstance.dep_iata} ${displayInstance.dep_terminal || ""} → ${displayInstance.dep_gate || "—"}`;
  const exitSubtitle = `${displayInstance.arr_iata} ${displayInstance.arr_gate || "—"} → Terminal exit`;

  return (
    <div className="pax-shell pax-shell--flight">
      <div className="pax-flight-screen">
        <div className="pax-flight-toolbar">
          <span className="pax-chip ok">{trip.intent}</span>
          <button
            type="button"
            className="pax-btn secondary"
            onClick={() => {
              clearPaxSession();
              navigate("/pax/login", { replace: true });
            }}
          >
            退出
          </button>
        </div>

        <div className="pax-flight-card-shell">
          <div className="pax-flight-grid">
            <div className="pax-flight-summary">
              {trip.intent === "transfer" ? (
                <div className="pax-tabs" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className={`pax-tab${activeLeg === "arr" ? " active" : ""}`}
                    onClick={() => {
                      setActiveLeg("arr");
                      setMapLeg("arr");
                      if (transfer) {
                        setInstance(transfer.arrival);
                        setBadge("ARRIVAL");
                      }
                    }}
                  >
                    抵达段
                  </button>
                  <button
                    type="button"
                    className={`pax-tab${activeLeg === "dep" ? " active" : ""}`}
                    onClick={() => {
                      setActiveLeg("dep");
                      setMapLeg("dep");
                      if (transfer) {
                        setInstance(transfer.departure);
                        setBadge("DEPARTURE");
                      }
                    }}
                  >
                    出发段
                  </button>
                </div>
              ) : null}

              {loadingFlight ? <p className="pax-flight-loading">查询航班…</p> : null}

              <FlightCard
                instance={displayInstance}
                badgeLabel={badge || displayInstance.status}
                activeSide={activeLeg}
                onOpenGate={() => setSheet("gate")}
                onOpenExit={() => setSheet("exit")}
                notice={flightNotice}
                weather={weather}
              />
            </div>

            <div className="pax-flight-map">
              <IndoorMapEmbed
                session={session}
                gateFrom={mapFrom}
                gateTo={mapTo}
                airport={mapAirport}
                mapLeg={mapLeg}
                onMapLegChange={setMapLeg}
                showLegToggle
              />
            </div>
          </div>
        </div>
      </div>

      <JourneySheets
        session={session}
        open={sheet}
        onClose={() => setSheet(null)}
        gateFlight={gateFlight}
        exitFlight={exitFlight}
        gateDate={gateDate}
        exitDate={exitDate}
        gateSubtitle={gateSubtitle}
        exitSubtitle={exitSubtitle}
      />
    </div>
  );
}
