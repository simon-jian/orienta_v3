import type { ReactNode } from "react";
import type { FlightInstance } from "../api/flightApi";
import type { AirportWeather } from "../api/weatherApi";
import { usePaxI18n } from "../i18n";
import { WeatherIcon } from "./WeatherIcon";
import {
  boardsAndDoors,
  durationText,
  localizeFlightStatus,
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
  terminalLabel,
  gateLabel,
}: {
  terminal?: string;
  gate?: string;
  align?: "left" | "right";
  terminalLabel: string;
  gateLabel: string;
}) {
  return (
    <div className={`fdc-tg${align === "right" ? " right" : ""}`}>
      <span className="fdc-tg-item">
        <span className="fdc-tg-label">{terminalLabel}</span>
        <span className="fdc-tg-term">{usable(terminal) ? terminal : "—"}</span>
      </span>
      <span className="fdc-tg-sep">-</span>
      <span className="fdc-tg-item">
        <span className="fdc-tg-label">{gateLabel}</span>
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
  const { t, intlLocale } = usePaxI18n();
  const statusRaw = (badgeLabel || instance.status || "SCHEDULED").toUpperCase();
  const status = localizeFlightStatus(statusRaw, t);
  const dep = primaryTime(instance, "dep", t, intlLocale);
  const arr = primaryTime(instance, "arr", t, intlLocale);
  const depStatus = scheduleStatus(instance, "dep", t);
  const arrStatus = scheduleStatus(instance, "arr", t);
  const { boards, doors } = boardsAndDoors(instance, boardsDoorsOverride, intlLocale);
  const na = t("common.na");
  const bag = usable(instance.baggage_claim) ? String(instance.baggage_claim) : na;
  const weatherText =
    weather?.available ? `${weather.temperature}°${weather.temperature_unit}` : na;
  const progress = progressForStatus(statusRaw);
  const boardsLabel = boards === "N/A" ? na : boards;
  const doorsLabel = doors === "N/A" ? na : doors;

  return (
    <section className="flight-data-card">
      <div className="fdc-head">
        <div className="fdc-flight">{instance.flight_iata || "—"}</div>
        <div className={`fdc-status ${statusTone(statusRaw)}`}>{status}</div>
      </div>

      <div className="fdc-route-visual">
        <div className="fdc-airport">
          <div className="fdc-airport-code">{instance.dep_iata || "—"}</div>
          <div className="fdc-airport-name">
            {usable(instance.dep_airport_name) ? instance.dep_airport_name : t("flight.depAirport")}
          </div>
          <TerminalGate
            terminal={instance.dep_terminal}
            gate={instance.dep_gate}
            terminalLabel={t("flight.terminal")}
            gateLabel={t("flight.gate")}
          />
        </div>
        <div className="fdc-route-mid">
          <div className="fdc-duration">{durationText(instance.duration_minutes, t)}</div>
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
            {usable(instance.arr_airport_name) ? instance.arr_airport_name : t("flight.arrAirport")}
          </div>
          <TerminalGate
            terminal={instance.arr_terminal}
            gate={instance.arr_gate}
            align="right"
            terminalLabel={t("flight.terminal")}
            gateLabel={t("flight.gate")}
          />
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
              <MetaRow label={t("flight.boards")} value={boardsLabel} pending={boards === "N/A"} />
              <MetaRow label={t("flight.doors")} value={doorsLabel} pending={doors === "N/A"} />
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
              <MetaRow label={t("flight.bag")} value={bag} pending={bag === na} />
              <MetaRow label={t("flight.weather")} value={weatherText} pending={!weather?.available}>
                {weather?.available ? <WeatherIcon iconKey={weather.icon_key} /> : null}
              </MetaRow>
            </div>
          </div>
        </div>
      </div>

      {notice ? <p className="fdc-notice">{notice}</p> : null}

      <div className="fdc-actions" aria-label={t("flight.journeyAria")}>
        <button type="button" className="fdc-action" onClick={onOpenGate}>
          {t("flight.timeToGate")}
        </button>
        <button type="button" className="fdc-action" onClick={onOpenExit}>
          {t("flight.timeToExit")}
        </button>
      </div>
    </section>
  );
}
