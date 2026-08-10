import { useCallback, useEffect, useState } from "react";
import {
  flightDateToday,
  getTimeToExit,
  getTimeToGate,
  patchJourneyPreferences,
  postJourneyEvent,
} from "../api/journeyApi";
import type { PaxSession } from "../session";

type Props = {
  session: PaxSession;
};

function rangeText(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const r = value as { min?: number; max?: number };
  if (typeof r.min !== "number" || typeof r.max !== "number") return "—";
  return `${Math.round(r.min)}–${Math.round(r.max)} min`;
}

export function JourneyPanels({ session }: Props) {
  const flight = session.passenger.flightId;
  const date = flightDateToday();
  const [gate, setGate] = useState<Record<string, unknown> | null>(null);
  const [exit, setExit] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [g, e] = await Promise.all([
        getTimeToGate(session.token, flight, date),
        getTimeToExit(session.token, flight, date).catch(() => null),
      ]);
      setGate(g);
      setExit(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "journey_failed");
    } finally {
      setBusy(false);
    }
  }, [session.token, flight, date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="pax-card">
        <h2>Time to Gate</h2>
        <p>根据航班与偏好估算到达登机口所需时间。</p>
        <div className="pax-chip">{busy ? "计算中…" : rangeText(gate?.range ?? gate?.totalRange)}</div>
        <div className="pax-row">
          <button type="button" className="pax-btn secondary" disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
          <button
            type="button"
            className="pax-btn ghost"
            disabled={busy}
            onClick={() =>
              void patchJourneyPreferences(session.token, flight, date, {
                securityLane: "standard",
              }).then(refresh)
            }
          >
            标准安检
          </button>
        </div>
      </section>

      <section className="pax-card">
        <h2>Time to Exit</h2>
        <p>到达后离机到出口的估计；可记录进度事件。</p>
        <div className="pax-chip">{busy ? "计算中…" : rangeText(exit?.range ?? exit?.remainingMinutes)}</div>
        <div className="pax-row">
          <button
            type="button"
            className="pax-btn secondary"
            disabled={busy}
            onClick={() => void postJourneyEvent(session.token, flight, date, "off-plane").then(refresh)}
          >
            已下机
          </button>
          <button
            type="button"
            className="pax-btn secondary"
            disabled={busy}
            onClick={() =>
              void postJourneyEvent(session.token, flight, date, "bags-collected").then(refresh)
            }
          >
            已取行李
          </button>
          <button
            type="button"
            className="pax-btn secondary"
            disabled={busy}
            onClick={() => void postJourneyEvent(session.token, flight, date, "outside").then(refresh)}
          >
            已出机场
          </button>
        </div>
      </section>

      {error ? <p className="pax-error">{error}</p> : null}
    </div>
  );
}
