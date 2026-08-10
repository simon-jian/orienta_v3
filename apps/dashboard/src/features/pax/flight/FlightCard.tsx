import type { ReactNode } from "react";
import type { FlightInstance } from "../api/flightApi";
import type { AirportWeather, WeatherIconKey } from "../api/weatherApi";

type Props = {
  instance: FlightInstance;
  badgeLabel?: string;
  activeSide?: "dep" | "arr";
  onOpenGate?: () => void;
  onOpenExit?: () => void;
  notice?: string;
  weather?: AirportWeather | null;
};

function usable(value: string | undefined | null): boolean {
  const v = (value || "").trim();
  return !!v && v !== "—" && v !== "N/A";
}

function statusTone(status: string): string {
  const text = status.toLowerCase();
  if (/cancel|divert|unavailable/.test(text)) return "bad";
  if (/delay|late/.test(text)) return "warn";
  if (/on time|arriv|land|en route|depart|scheduled|gate/.test(text)) return "ok";
  return "neu";
}

function progressForStatus(status: string): number {
  const text = status.toLowerCase();
  if (/arriv|land|gate arrival/.test(text)) return 96;
  if (/en route|airborne|depart/.test(text)) return 55;
  return 8;
}

function formatClock(local: string | undefined): { time: string; period: string; dateLabel: string } {
  const raw = (local || "—").trim();
  if (!raw || raw === "—") return { time: "—", period: "", dateLabel: "" };
  // "2026-08-09 17:15" or "2026-08-09, 5:15 PM"
  const dateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  let dateLabel = "";
  if (dateMatch) {
    try {
      const d = new Date(`${dateMatch[1]}T12:00:00`);
      dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
    } catch {
      dateLabel = dateMatch[1];
    }
  }
  const m = raw.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (!m) return { time: raw, period: "", dateLabel };
  return { time: m[1] || raw, period: (m[2] || "").toUpperCase(), dateLabel };
}

function formatUtcClock(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: timeZone || "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function primaryTime(inst: FlightInstance, side: "dep" | "arr") {
  const scheduled = side === "dep" ? inst.dep_time_local : inst.arr_time_local;
  const estimated = side === "dep" ? inst.dep_estimated_local : inst.arr_estimated_local;
  const actual = side === "dep" ? inst.dep_actual_local : inst.arr_actual_local;
  if (usable(actual)) {
    return { ...formatClock(actual), label: side === "dep" ? "实际出发时间" : "实际抵达时间" };
  }
  if (usable(estimated) && estimated !== scheduled) {
    return { ...formatClock(estimated), label: side === "dep" ? "预计出发时间" : "预计抵达时间" };
  }
  return { ...formatClock(scheduled), label: side === "dep" ? "计划出发时间" : "计划抵达时间" };
}

function durationText(minutes: number | null | undefined): string {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "飞行时长";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours}小时 ${rest}分钟` : `${rest}分钟`;
}

function scheduleStatus(
  inst: FlightInstance,
  side: "dep" | "arr",
): { text: string; cssClass: string } {
  const delay =
    side === "dep" ? inst.departure_delay_minutes : inst.arrival_delay_minutes;
  if (delay == null || !Number.isFinite(delay)) {
    return { text: "Awaiting update", cssClass: "status-unknown" };
  }
  if (delay <= -2) {
    const mins = Math.abs(Math.round(delay));
    return { text: `${mins} min early`, cssClass: "status-early" };
  }
  if (delay >= 2) {
    const mins = Math.round(delay);
    if (mins >= 60) {
      return {
        text: `${Math.floor(mins / 60)}h ${mins % 60}m delayed`,
        cssClass: mins >= 180 ? "status-severe-delay" : "status-delayed",
      };
    }
    return { text: `${mins} min delayed`, cssClass: "status-delayed" };
  }
  return { text: "On time", cssClass: "status-on-time" };
}

function boardsAndDoors(inst: FlightInstance): { boards: string; doors: string } {
  const boardsFromApi = formatUtcClock(inst.boarding_time_utc, inst.origin_timezone);
  if (boardsFromApi) {
    const doorsIso =
      inst.actual_out_utc || inst.estimated_out_utc || inst.scheduled_out_utc || inst.dep_scheduled_iso;
    let doors = "";
    if (doorsIso) {
      const ms = Date.parse(doorsIso) - 10 * 60_000;
      if (Number.isFinite(ms)) doors = formatUtcClock(new Date(ms).toISOString(), inst.origin_timezone);
    }
    return { boards: boardsFromApi, doors: doors || "N/A" };
  }

  const depIso = inst.estimated_out_utc || inst.scheduled_out_utc || inst.dep_scheduled_iso;
  if (!depIso) return { boards: "N/A", doors: "N/A" };
  const depMs = Date.parse(depIso);
  if (!Number.isFinite(depMs)) return { boards: "N/A", doors: "N/A" };
  const boards = formatUtcClock(new Date(depMs - 40 * 60_000).toISOString(), inst.origin_timezone);
  const doors = formatUtcClock(new Date(depMs - 10 * 60_000).toISOString(), inst.origin_timezone);
  return { boards: boards || "N/A", doors: doors || "N/A" };
}

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

const WEATHER_PATHS: Record<WeatherIconKey, string> = {
  "clear-day":
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  "clear-night": '<path d="M19.5 15.6A8 8 0 0 1 8.4 4.5a8 8 0 1 0 11.1 11.1Z"/>',
  "partly-cloudy-day":
    '<circle cx="8" cy="8" r="3"/><path d="M8 2v2M2 8h2M3.8 3.8l1.4 1.4M15.5 18H6.8a3.8 3.8 0 0 1 .8-7.5A5 5 0 0 1 17 12a3 3 0 1 1-1.5 6Z"/>',
  "partly-cloudy-night":
    '<path d="M13 3a5 5 0 0 1-6 6 5 5 0 0 0 6-6ZM15.5 18H6.8a3.8 3.8 0 0 1 .8-7.5A5 5 0 0 1 17 12a3 3 0 1 1-1.5 6Z"/>',
  cloudy: '<path d="M17.5 19H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 13a3 3 0 1 1-.5 6Z"/>',
  fog: '<path d="M18 14H6a3.5 3.5 0 0 1 .7-6.9A5 5 0 0 1 16 8.5"/><path d="M4 18h16M7 21h10"/>',
  rain: '<path d="M17.5 15H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 9a3 3 0 1 1-.5 6Z"/><path d="m8 18-1 2M13 18l-1 2M18 18l-1 2"/>',
  snow: '<path d="M17.5 14H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 8a3 3 0 1 1-.5 6Z"/><path d="M8 18h.01M13 20h.01M18 18h.01"/>',
  thunderstorm:
    '<path d="M17.5 14H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 8a3 3 0 1 1-.5 6Z"/><path d="m13 16-2 4h3l-2 3"/>',
  unknown:
    '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-1 .5-1 1.1-1 2M12 17h.01"/>',
};

function WeatherIcon({ iconKey }: { iconKey: WeatherIconKey }) {
  const path = WEATHER_PATHS[iconKey] || WEATHER_PATHS.unknown;
  return (
    <svg
      className="fdc-weather-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: path }}
    />
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
}: Props) {
  const status = (badgeLabel || instance.status || "SCHEDULED").toUpperCase();
  const dep = primaryTime(instance, "dep");
  const arr = primaryTime(instance, "arr");
  const depStatus = scheduleStatus(instance, "dep");
  const arrStatus = scheduleStatus(instance, "arr");
  const { boards, doors } = boardsAndDoors(instance);
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

export function placeholderFlight(flightId: string, gateId?: string): FlightInstance {
  return {
    flight_iata: flightId || "—",
    dep_iata: "—",
    arr_iata: "—",
    dep_time_local: "—",
    arr_time_local: "—",
    dep_terminal: "—",
    dep_gate: gateId || "—",
    arr_terminal: "—",
    arr_gate: "—",
    status: "UNAVAILABLE",
  };
}
