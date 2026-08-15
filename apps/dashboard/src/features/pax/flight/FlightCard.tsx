import type { ReactNode } from "react";
import type { FlightInstance } from "../api/flightApi";
import type { AirportWeather } from "../api/weatherApi";
import { WeatherIcon } from "./WeatherIcon";
import {
  boardsAndDoors,
  durationText,
  primaryTime,
  progressForStatus,
  scheduleStatus,
  statusTone,
  usable,
  type BoardsDoors,
  placeholderFlight,
} from "./flightCardHelpers";

export { placeholderFlight };

type Props = {
  instance: FlightInstance;
  badgeLabel?: string;
  activeSide?: "dep" | "arr";
  onOpenGate?: () => void;
  onOpenExit?: () => void;
  notice?: string;
  weather?: AirportWeather | null;
  /** Journey time-to-gate hydrate for Boards/Doors. */
  boardsDoors?: Partial<BoardsDoors> | null;
};

function TerminalGate({
  terminal,
  gate,
  align = "left",
}: {
  terminal?: string;
  gate?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`fdc-tg${align === "right" ? " right" : ""}`}>
      <span className="fdc-tg-item">
        <span className="fdc-tg-label">Terminal</span>
        <span className="fdc-tg-term">{usable(terminal) ? terminal : "—"}</span>
      </span>
      <span className="fdc-tg-sep">-</span>
      <span className="fdc-tg-item">
        <span className="fdc-tg-label">Gate</span>
        <span className="fdc-tg-gate">{usable(gate) ? gate : "—"}</span>
      </span>
    </div>
  );
}

function MetaRow({
  label,
  value,
  pending,
  children,
}: {
  label: string;
  value: string;
  pending?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="fdc-meta-row">
      <span className="fdc-meta-label">{label}</span>
      <span className={`fdc-meta-value${pending ? " pending" : ""}`}>
        {children}
        {value}
      </span>
    </div>
  );
}

export function FlightCard({
  instance,
  badgeLabel,
  activeSide = "dep",
  onOpenGate,
  onOpenExit,
  notice,
  weather,
  boardsDoors: boardsDoorsOverride,
}: Props) {
  const status = (badgeLabel || instance.status || "SCHEDULED").toUpperCase();
  const dep = primaryTime(instance, "dep");
  const arr = primaryTime(instance, "arr");
  const depStatus = scheduleStatus(instance, "dep");
  const arrStatus = scheduleStatus(instance, "arr");
  const { boards, doors } = boardsAndDoors(instance, boardsDoorsOverride);
  const bag = usable(instance.baggage_claim) ? String(instance.baggage_claim) : "N/A";
  const weatherText =
    weather?.available ? `${weather.temperature}°${weather.temperature_unit}` : "N/A";
  const progress = progressForStatus(status);

  return (
    <section className="flight-data-card">
      <div className="fdc-head">
        <div className="fdc-flight">{instance.flight_iata || "—"}</div>
        <div className={`fdc-status ${statusTone(status)}`}>{status}</div>
      </div>

      <div className="fdc-route-visual">
        <div className="fdc-airport">
          <div className="fdc-airport-code">{instance.dep_iata || "—"}</div>
          <div className="fdc-airport-name">
            {usable(instance.dep_airport_name) ? instance.dep_airport_name : "出发机场"}
          </div>
          <TerminalGate terminal={instance.dep_terminal} gate={instance.dep_gate} />
        </div>
        <div className="fdc-route-mid">
          <div className="fdc-duration">{durationText(instance.duration_minutes)}</div>
          <div className="fdc-flight-path" aria-hidden="true">
            <div className="fdc-flight-track" />
            <div className="fdc-flight-progress" style={{ width: `${progress}%` }} />
            <span className="fdc-plane" style={{ left: `${progress}%` }}>
              <span className="fdc-plane-glyph">✈</span>
            </span>
          </div>
        </div>
        <div className="fdc-airport right">
          <div className="fdc-airport-code">{instance.arr_iata || "—"}</div>
          <div className="fdc-airport-name">
            {usable(instance.arr_airport_name) ? instance.arr_airport_name : "抵达机场"}
          </div>
          <TerminalGate terminal={instance.arr_terminal} gate={instance.arr_gate} align="right" />
        </div>
      </div>

      <div className="fdc-times">
        <div className={`fdc-side${activeSide === "dep" ? " active" : ""}`}>
          <div className="fdc-side-grid">
            <div className="fdc-side-main">
              <div className="fdc-place">
                {instance.dep_iata || "—"}
                {dep.dateLabel ? <span className="fdc-weekday"> · {dep.dateLabel}</span> : null}
              </div>
              <div className="fdc-time-label">{dep.label}</div>
              <div className={`fdc-time ${depStatus.cssClass}`}>
                {dep.time}
                {dep.period ? <span className="fdc-period">{dep.period}</span> : null}
              </div>
              <div className={`fdc-time-status ${depStatus.cssClass}`}>{depStatus.text}</div>
            </div>
            <div className="fdc-meta-stack">
              <MetaRow label="Boards" value={boards} pending={boards === "N/A"} />
              <MetaRow label="Doors" value={doors} pending={doors === "N/A"} />
            </div>
          </div>
        </div>
        <div className={`fdc-side${activeSide === "arr" ? " active" : ""}`}>
          <div className="fdc-side-grid">
            <div className="fdc-side-main">
              <div className="fdc-place">
                {instance.arr_iata || "—"}
                {arr.dateLabel ? <span className="fdc-weekday"> · {arr.dateLabel}</span> : null}
              </div>
              <div className="fdc-time-label">{arr.label}</div>
              <div className={`fdc-time ${arrStatus.cssClass}`}>
                {arr.time}
                {arr.period ? <span className="fdc-period">{arr.period}</span> : null}
              </div>
              <div className={`fdc-time-status ${arrStatus.cssClass}`}>{arrStatus.text}</div>
            </div>
            <div className="fdc-meta-stack">
              <MetaRow label="Bag" value={bag} pending={bag === "N/A"} />
              <MetaRow label="Weather" value={weatherText} pending={!weather?.available}>
                {weather?.available ? <WeatherIcon iconKey={weather.icon_key} /> : null}
              </MetaRow>
            </div>
          </div>
        </div>
      </div>

      {notice ? <p className="fdc-notice">{notice}</p> : null}

      <div className="fdc-actions" aria-label="Airport journey times">
        <button type="button" className="fdc-action" onClick={onOpenGate}>
          Time to Gate
        </button>
        <button type="button" className="fdc-action" onClick={onOpenExit}>
          Time to Exit
        </button>
      </div>
    </section>
  );
}
