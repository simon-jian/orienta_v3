import type { FlightInstance } from "../api/flightApi";
import type { PaxMessageKey, PaxTranslate } from "../i18n/locales";

export function usable(value: string | undefined | null): boolean {
  const v = (value || "").trim();
  return !!v && v !== "—" && v !== "N/A";
}

export function statusTone(status: string): string {
  const text = status.toLowerCase();
  if (/cancel|divert|unavailable/.test(text)) return "bad";
  if (/delay|late/.test(text)) return "warn";
  if (/on time|arriv|land|en route|depart|scheduled|gate/.test(text)) return "ok";
  return "neu";
}

export function progressForStatus(status: string): number {
  const text = status.toLowerCase();
  if (/arriv|land|gate arrival/.test(text)) return 96;
  if (/en route|airborne|depart/.test(text)) return 55;
  return 8;
}

export function formatClock(
  local: string | undefined,
  locale = "en-US",
): { time: string; period: string; dateLabel: string } {
  const raw = (local || "—").trim();
  if (!raw || raw === "—") return { time: "—", period: "", dateLabel: "" };
  const dateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  let dateLabel = "";
  if (dateMatch) {
    try {
      const d = new Date(`${dateMatch[1]}T12:00:00`);
      dateLabel = d.toLocaleDateString(locale, { month: "short", day: "numeric", weekday: "short" });
    } catch {
      dateLabel = dateMatch[1] || "";
    }
  }
  const m = raw.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (!m) return { time: raw, period: "", dateLabel };
  return { time: m[1] || raw, period: (m[2] || "").toUpperCase(), dateLabel };
}

export function formatUtcClock(
  iso: string | null | undefined,
  timeZone?: string | null,
  locale = "en-US",
): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString(locale, {
      timeZone: timeZone || "UTC",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Prefer short clock from journey local strings like "Aug 10, 4:40 PM". */
export function shortLocalClock(local: string | null | undefined): string {
  const raw = (local || "").trim();
  if (!raw) return "";
  const m = raw.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (!m) return raw;
  return `${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ""}`;
}

export function primaryTime(inst: FlightInstance, side: "dep" | "arr", t: PaxTranslate, locale = "en-US") {
  const scheduled = side === "dep" ? inst.dep_time_local : inst.arr_time_local;
  const estimated = side === "dep" ? inst.dep_estimated_local : inst.arr_estimated_local;
  const actual = side === "dep" ? inst.dep_actual_local : inst.arr_actual_local;
  if (usable(actual)) {
    return { ...formatClock(actual, locale), label: t(side === "dep" ? "flight.actualDep" : "flight.actualArr") };
  }
  if (usable(estimated) && estimated !== scheduled) {
    return { ...formatClock(estimated, locale), label: t(side === "dep" ? "flight.estDep" : "flight.estArr") };
  }
  return { ...formatClock(scheduled, locale), label: t(side === "dep" ? "flight.schedDep" : "flight.schedArr") };
}

export function durationText(minutes: number | null | undefined, t: PaxTranslate): string {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return t("flight.durationLabel");
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? t("flight.durationHm", { h: hours, m: rest }) : t("flight.durationM", { m: rest });
}

export function scheduleStatus(
  inst: FlightInstance,
  side: "dep" | "arr",
  t: PaxTranslate,
): { text: string; cssClass: string } {
  const delay =
    side === "dep" ? inst.departure_delay_minutes : inst.arrival_delay_minutes;
  if (delay == null || !Number.isFinite(delay)) {
    return { text: t("flight.awaitingUpdate"), cssClass: "status-unknown" };
  }
  if (delay <= -2) {
    const mins = Math.abs(Math.round(delay));
    return { text: t("flight.minEarly", { mins }), cssClass: "status-early" };
  }
  if (delay >= 2) {
    const mins = Math.round(delay);
    if (mins >= 60) {
      return {
        text: t("flight.delayedHm", { h: Math.floor(mins / 60), m: mins % 60 }),
        cssClass: mins >= 180 ? "status-severe-delay" : "status-delayed",
      };
    }
    return { text: t("flight.minDelayed", { mins }), cssClass: "status-delayed" };
  }
  return { text: t("flight.onTime"), cssClass: "status-on-time" };
}

export function localizeFlightStatus(status: string, t: PaxTranslate): string {
  const raw = (status || "").trim();
  if (!raw) return raw;
  const norm = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const key = `flight.status.${norm}` as PaxMessageKey;
  const label = t(key);
  return label === key ? raw : label;
}

export type BoardsDoors = { boards: string; doors: string };

export function boardsAndDoors(
  inst: FlightInstance,
  override?: Partial<BoardsDoors> | null,
  locale = "en-US",
): BoardsDoors {
  if (override?.boards || override?.doors) {
    const fallback = boardsAndDoorsFromInstance(inst, locale);
    return {
      boards: override.boards || fallback.boards,
      doors: override.doors || fallback.doors,
    };
  }
  return boardsAndDoorsFromInstance(inst, locale);
}

function boardsAndDoorsFromInstance(inst: FlightInstance, locale = "en-US"): BoardsDoors {
  const boardsFromApi = formatUtcClock(inst.boarding_time_utc, inst.origin_timezone, locale);
  if (boardsFromApi) {
    const doorsIso =
      inst.actual_out_utc || inst.estimated_out_utc || inst.scheduled_out_utc || inst.dep_scheduled_iso;
    let doors = "";
    if (doorsIso) {
      const ms = Date.parse(doorsIso) - 10 * 60_000;
      if (Number.isFinite(ms)) doors = formatUtcClock(new Date(ms).toISOString(), inst.origin_timezone, locale);
    }
    return { boards: boardsFromApi, doors: doors || "N/A" };
  }

  const depIso = inst.estimated_out_utc || inst.scheduled_out_utc || inst.dep_scheduled_iso;
  if (!depIso) return { boards: "N/A", doors: "N/A" };
  const depMs = Date.parse(depIso);
  if (!Number.isFinite(depMs)) return { boards: "N/A", doors: "N/A" };
  const boards = formatUtcClock(new Date(depMs - 40 * 60_000).toISOString(), inst.origin_timezone, locale);
  const doors = formatUtcClock(new Date(depMs - 10 * 60_000).toISOString(), inst.origin_timezone, locale);
  return { boards: boards || "N/A", doors: doors || "N/A" };
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
