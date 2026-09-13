import { useEffect, useState } from "react";
import type { PaxSession } from "../session";
import { cancelRobotRequest, fetchRobotRequest, submitRobotRequest } from "../api/robotApi";
import { paxErrorMessage, usePaxT, type PaxMessageKey } from "../i18n";
import {
  ROBOT_SERVICES,
  type RobotRequest,
  type RobotServiceType,
} from "./assistTypes";

type Props = {
  session: PaxSession;
  unreadChat: boolean;
  /** undefined = ignore (HTTP hydrate owns state); null = cleared via WS */
  liveRequest?: RobotRequest | null;
  onFocusChat: () => void;
  onOpenChange?: (open: boolean) => void;
};

export function RobotBookingPanel({
  session,
  unreadChat,
  liveRequest,
  onFocusChat,
  onOpenChange,
}: Props) {
  const t = usePaxT();
  const [open, setOpen] = useState(false);
  const [serviceType, setServiceType] = useState<RobotServiceType>("follow");
  const [partySize, setPartySize] = useState(1);
  const [origin, setOrigin] = useState(() => t("robot.originDefault"));
  const [destination, setDestination] = useState(() =>
    session.passenger.gateId ? t("robot.destGate", { gate: session.passenger.gateId }) : t("robot.destDefault"),
  );
  const [note, setNote] = useState("");
  const [request, setRequest] = useState<RobotRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchRobotRequest(session)
      .then((r) => {
        if (!cancelled && r && r.status !== "cancelled") setRequest(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (liveRequest === undefined) return;
    if (!liveRequest || liveRequest.status === "cancelled") {
      setRequest(null);
      return;
    }
    setRequest(liveRequest);
  }, [liveRequest]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const tracking = !!request && request.status !== "cancelled";
  const phase = tracking ? request.status : "idle";

  async function onSubmit() {
    if (busy || tracking) return;
    setBusy(true);
    setError("");
    try {
      const created = await submitRobotRequest(session, {
        serviceType,
        partySize,
        origin,
        destination,
        note,
      });
      setRequest(created);
      setOpen(true);
    } catch (err) {
      setError(paxErrorMessage(t, err instanceof Error ? err.message : "submit_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await cancelRobotRequest(session);
      setRequest(null);
      setNote("");
    } catch (err) {
      setError(paxErrorMessage(t, err instanceof Error ? err.message : "cancel_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`pax-robot-booking${open ? " is-open" : ""}${tracking ? " is-tracking" : ""}`}>
      <div className="pax-robot-booking-bar">
        <button
          type="button"
          className="pax-robot-booking-main"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="pax-robot-booking-main-label">
            {tracking ? t("robot.tracking") : t("robot.book")}
          </span>
          <span className={`pax-robot-state-pill${tracking ? " is-live" : ""}`}>
            {t(`robot.status.${phase}` as PaxMessageKey)}
          </span>
        </button>
        <div className="pax-robot-booking-head-actions">
          {unreadChat ? (
            <button type="button" className="pax-robot-chat-alert" onClick={onFocusChat}>
              {t("robot.support")}
            </button>
          ) : null}
          <button type="button" className="pax-robot-booking-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? t("robot.collapse") : tracking ? t("robot.details") : t("robot.bookShort")}
          </button>
        </div>
      </div>

      {!open && tracking ? (
        <div className="pax-robot-tracking-compact">{t("robot.compactHint")}</div>
      ) : null}
      {error ? <div className="pax-robot-error">{error}</div> : null}

      {open ? (
        <div className="pax-robot-booking-body">
          {!tracking ? (
            <div className="pax-robot-form">
              <p className="pax-robot-booking-sub">
                {t("robot.formLead")}
              </p>
              <div className="pax-robot-service-cards" role="radiogroup" aria-label={t("robot.serviceAria")}>
                {ROBOT_SERVICES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`pax-robot-service-card${serviceType === s.id ? " active" : ""}`}
                    onClick={() => setServiceType(s.id)}
                  >
                    <b>{t(`robot.svc.${s.id}.title` as PaxMessageKey)}</b>
                    <span>{t(`robot.svc.${s.id}.blurb` as PaxMessageKey)}</span>
                  </button>
                ))}
              </div>
              <div className="pax-robot-route-row">
                <label>
                  {t("robot.party")}
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={partySize}
                    onChange={(e) => setPartySize(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                  />
                </label>
                <label>
                  {t("robot.origin")}
                  <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
                </label>
                <label>
                  {t("robot.destination")}
                  <input value={destination} onChange={(e) => setDestination(e.target.value)} />
                </label>
              </div>
              <label>
                {t("robot.note")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("robot.notePlaceholder")}
                />
              </label>
              <button type="button" className="pax-btn" disabled={busy} onClick={() => void onSubmit()}>
                {busy ? t("robot.submitting") : t("robot.submit")}
              </button>
            </div>
          ) : request ? (
            <div className="pax-robot-tracking-card">
              <div className="pax-robot-track-steps">
                {(["submitted", "assigned", "en_route", "serving"] as const).map((step, i) => {
                  const order = ["submitted", "assigned", "en_route", "serving"] as const;
                  const activeIdx = Math.max(0, order.indexOf(request.status as (typeof order)[number]));
                  const done = i <= activeIdx;
                  return (
                    <div key={step} className={`pax-robot-track-step${done ? " done" : ""}`}>
                      {t(`robot.status.${step}` as PaxMessageKey)}
                    </div>
                  );
                })}
              </div>
              <p className="pax-robot-booking-sub">{t("robot.trackingLead")}</p>
              <button type="button" className="pax-btn secondary" disabled={busy} onClick={() => void onCancel()}>
                {t("robot.cancel")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
