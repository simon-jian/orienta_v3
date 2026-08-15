import { useEffect, useState } from "react";
import type { PaxSession } from "../session";
import { cancelRobotRequest, fetchRobotRequest, submitRobotRequest } from "../api/robotApi";
import {
  ROBOT_SERVICES,
  robotStatusLabel,
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
  const [open, setOpen] = useState(false);
  const [serviceType, setServiceType] = useState<RobotServiceType>("follow");
  const [partySize, setPartySize] = useState(1);
  const [origin, setOrigin] = useState("旅客当前位置");
  const [destination, setDestination] = useState(
    session.passenger.gateId ? `Gate ${session.passenger.gateId}` : "出发登机口",
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
      setError(err instanceof Error ? err.message : "submit_failed");
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
      setError(err instanceof Error ? err.message : "cancel_failed");
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
            {tracking ? "机器人服务进行中" : "预约机器人服务"}
          </span>
          <span className={`pax-robot-state-pill${tracking ? " is-live" : ""}`}>
            {robotStatusLabel(phase)}
          </span>
        </button>
        <div className="pax-robot-booking-head-actions">
          {unreadChat ? (
            <button type="button" className="pax-robot-chat-alert" onClick={onFocusChat}>
              客服
            </button>
          ) : null}
          <button type="button" className="pax-robot-booking-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? "收起" : tracking ? "详情" : "预约"}
          </button>
        </div>
      </div>

      {!open && tracking ? (
        <div className="pax-robot-tracking-compact">调度确认后会更新状态 · 可继续在下方发消息</div>
      ) : null}
      {error ? <div className="pax-robot-error">{error}</div> : null}

      {open ? (
        <div className="pax-robot-booking-body">
          {!tracking ? (
            <div className="pax-robot-form">
              <p className="pax-robot-booking-sub">
                提交后由调度确认并分配机器人；对话输入框始终可用。
              </p>
              <div className="pax-robot-service-cards" role="radiogroup" aria-label="机器人服务类型">
                {ROBOT_SERVICES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`pax-robot-service-card${serviceType === s.id ? " active" : ""}`}
                    onClick={() => setServiceType(s.id)}
                  >
                    <b>{s.title}</b>
                    <span>{s.blurb}</span>
                  </button>
                ))}
              </div>
              <div className="pax-robot-route-row">
                <label>
                  人数
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={partySize}
                    onChange={(e) => setPartySize(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                  />
                </label>
                <label>
                  当前位置 / 接应点
                  <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
                </label>
                <label>
                  目的地
                  <input value={destination} onChange={(e) => setDestination(e.target.value)} />
                </label>
              </div>
              <label>
                补充说明
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：需要轮椅、行动不便、随身行李较多等"
                />
              </label>
              <button type="button" className="pax-btn" disabled={busy} onClick={() => void onSubmit()}>
                {busy ? "提交中…" : "提交预约"}
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
                      {robotStatusLabel(step)}
                    </div>
                  );
                })}
              </div>
              <p className="pax-robot-booking-sub">状态更新后会同步；也可继续在下方与助手沟通。</p>
              <button type="button" className="pax-btn secondary" disabled={busy} onClick={() => void onCancel()}>
                取消 / 重新预约
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
