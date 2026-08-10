import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, MsgRecord } from "../../types/types";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../config/indoorMap";
import { connectPaxRealtime, type PaxRealtime } from "../../services/realtime";
import {
  checkPdrBackendAvailable,
  configurePdrSession,
  isPdrSessionActive,
  setPdrPlannedPath,
  startPdrSession,
  stopPdrSession,
  type PdrTrajectoryUpdate,
} from "../../services/pdrClient";
import {
  clearPaxSession,
  fetchPaxSession,
  getStoredPaxSession,
  getStoredPaxTrip,
  type PaxSession,
  type PaxTripContext,
} from "./session";
import { apiUrl } from "../../config/api";
import { clientDefaultAirport } from "../../config/client";
import { usePaxPush } from "./hooks/usePaxPush";
import "./styles/pax.css";

type RobotServiceType = "follow" | "um" | "wheelchair" | "lost_delivery";
type RobotPhase = "idle" | "submitted" | "assigned" | "en_route" | "serving";

const ROBOT_SERVICES: { id: RobotServiceType; title: string; blurb: string }[] = [
  { id: "follow", title: "跟随服务", blurb: "旅客站到机器人前方，识别锁定后自动跟随" },
  { id: "um", title: "UM 无人陪", blurb: "儿童资料、证件核验、交接责任链" },
  { id: "wheelchair", title: "特殊协助", blurb: "轮椅、急客、老人、语言或医疗协助" },
  { id: "lost_delivery", title: "楼内递送", blurb: "证件、药品、失物、小件物品递送" },
];

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function resolveTrip(session: PaxSession): PaxTripContext {
  return session.trip || getStoredPaxTrip() || {
    intent: "depart",
    flight: session.passenger.flightId,
  };
}

function infoStripFor(session: PaxSession, trip: PaxTripContext) {
  if (trip.intent === "transfer") {
    return {
      inbound: trip.arrivalFlight ? `${trip.arrivalFlight}` : "—",
      outbound: trip.departureFlight || session.passenger.flightId || "—",
    };
  }
  if (trip.intent === "arrive") {
    return {
      inbound: trip.flight || session.passenger.flightId || "—",
      outbound: "—",
    };
  }
  return {
    inbound: "—",
    outbound: trip.flight || session.passenger.flightId || "—",
  };
}

function MessageList({
  messages,
  plan,
}: {
  messages: ChatMessage[];
  plan: "free" | "premium";
}) {
  if (!messages.length) {
    return (
      <div className="pax-assist-watermark">
        Air China 智能中转 · Orienta Transfer Assist
        <span>
          {plan === "premium"
            ? "Premium：可与运营助手对话。"
            : "Free：由 AI agent 协助。可收通知并分享位置。"}
        </span>
      </div>
    );
  }
  return (
    <>
      {messages.map((m) => {
        const own = m.from === "pax";
        const role =
          m.from === "pax" ? "pax" : m.from === "system" ? "system" : m.from === "agent" ? "agent" : "admin";
        return (
          <div key={m.id} className={`pax-assist-msg ${own ? "right" : "left"}`}>
            <div className="pax-assist-msg-meta">
              {own ? "You" : m.from} · {fmtTime(m.createdAt)}
            </div>
            <div className={`pax-assist-bubble ${role}`}>{m.body}</div>
          </div>
        );
      })}
    </>
  );
}

function isLatLng(value: unknown): value is { lat: number; lng: number } {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  return !!v && typeof v.lat === "number" && typeof v.lng === "number";
}

function isLngLatPath(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number")
  );
}

function postPaxFallback(session: PaxSession, path: string, body: Record<string, unknown>): void {
  void fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      tenantId: session.passenger.tenantId,
      passengerId: session.passenger.id,
      ...body,
    }),
    keepalive: true,
  }).catch(() => {});
}

export default function PaxAppPage() {
  const [session, setSession] = useState<PaxSession | null>(() => getStoredPaxSession());
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [rtUp, setRtUp] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<MsgRecord[]>([]);
  const [dismissedNotify, setDismissedNotify] = useState<Set<string>>(() => new Set());
  const [input, setInput] = useState("");
  const [locationStatus, setLocationStatus] = useState("Location: —");
  const [navDebug, setNavDebug] = useState("");
  const [pdrStatus, setPdrStatus] = useState("");
  const [pdrActive, setPdrActive] = useState(false);
  const [pdrBackendOk, setPdrBackendOk] = useState<boolean | null>(null);
  const [pdrHasRoute, setPdrHasRoute] = useState(false);
  const [tab, setTab] = useState<"assist" | "nav">("assist");
  const [robotOpen, setRobotOpen] = useState(false);
  const [robotService, setRobotService] = useState<RobotServiceType>("follow");
  const [robotParty, setRobotParty] = useState(1);
  const [robotOrigin, setRobotOrigin] = useState("旅客当前位置");
  const [robotDestination, setRobotDestination] = useState("出发登机口");
  const [robotNote, setRobotNote] = useState("");
  const [robotPhase, setRobotPhase] = useState<RobotPhase>("idle");
  const [unreadChat, setUnreadChat] = useState(false);
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const realtimeRef = useRef<PaxRealtime | null>(null);
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lastTrajectoryAtRef = useRef(0);
  const pdrActiveRef = useRef(false);
  const push = usePaxPush(session);

  const canChat = !!session?.capabilities.includes("operator_chat");
  const canShareLocation = !!session?.capabilities.includes("share_location");
  const trip = useMemo(() => (session ? resolveTrip(session) : null), [session]);
  const strip = useMemo(
    () => (session && trip ? infoStripFor(session, trip) : { inbound: "—", outbound: "—" }),
    [session, trip],
  );

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
        if (cancelled) return;
        setSession(s);
        if (s.passenger.gateId) {
          setRobotDestination(`Gate ${s.passenger.gateId}`);
        }
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
    if (!session) return;
    const rt = connectPaxRealtime({
      tenantId: session.passenger.tenantId,
      passengerId: session.passenger.id,
      displayName: session.passenger.name,
      plan: session.plan,
      flightId: session.passenger.flightId,
      gateId: session.passenger.gateId,
      sessionToken: session.token,
      onConnectionChange: setRtUp,
      onMessage: (msg) => {
        setNotifications((prev) => [msg, ...prev].slice(0, 20));
        rt.ack(msg.messageId);
      },
      onChatMsg: (msg) => {
        setChat((prev) => [...prev, msg]);
        if (msg.from !== "pax") setUnreadChat(true);
      },
      onChatHistory: (messages) => setChat(messages),
      onLocRequest: () => setLocationStatus("Operator requested your current location."),
    });
    realtimeRef.current = rt;
    return () => {
      rt.close();
      realtimeRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    postPaxFallback(session, "/api/pax/presence", { online: true });
    const timer = window.setInterval(() => {
      postPaxFallback(session, "/api/pax/presence", { online: true });
    }, 12_000);
    const onBeforeUnload = () => {
      postPaxFallback(session, "/api/pax/presence", { online: false });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", onBeforeUnload);
      postPaxFallback(session, "/api/pax/presence", { online: false });
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    checkPdrBackendAvailable()
      .then((ok) => {
        if (!cancelled) setPdrBackendOk(ok);
      })
      .catch(() => {
        if (!cancelled) setPdrBackendOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    pdrActiveRef.current = pdrActive;
  }, [pdrActive]);

  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat]);

  function relayTrajectory(activeSession: PaxSession, update: PdrTrajectoryUpdate) {
    const path = update.path.length ? update.path : [update.position];
    realtimeRef.current?.sendTrajectory(path, update.position);
    postPaxFallback(activeSession, "/api/pax/tourist-position", {
      lat: update.position.lat,
      lng: update.position.lng,
      path,
    });
    lastTrajectoryAtRef.current = Date.now();
    setPdrActive(true);
    setLocationStatus(`PDR live · ${fmtTime(Date.now())}`);
  }

  useEffect(() => {
    if (!session) return;

    void configurePdrSession({
      passengerId: session.passenger.id,
      onStatus: setPdrStatus,
      onTrajectory: (update) => relayTrajectory(session, update),
      postToMap: (update) => {
        const win = mapFrameRef.current?.contentWindow;
        if (!win) return;
        let origin = window.location.origin;
        try {
          origin = new URL(mapFrameRef.current?.src || INDOOR_MAP_URL, window.location.href).origin;
        } catch {
          /* ignore */
        }
        win.postMessage(
          {
            type: "orienta-pax-map-position",
            source: "pdr",
            position: update.position,
            path: update.path,
            headingRad: update.headingRad,
          },
          origin,
        );
      },
    });

    return () => {
      stopPdrSession();
      setPdrActive(false);
    };
  }, [session]);

  async function togglePdr() {
    if (isPdrSessionActive()) {
      stopPdrSession();
      setPdrActive(false);
      setPdrStatus("");
      return;
    }
    if (pdrBackendOk === false) {
      setPdrStatus("PDR backend unavailable — set PDR_API_ORIGIN (see README)");
      return;
    }
    if (!pdrHasRoute) {
      setPdrStatus("No route yet — waiting for the map to compute a gate-to-gate path to follow");
      return;
    }
    try {
      await startPdrSession();
      setPdrActive(isPdrSessionActive());
    } catch (err) {
      setPdrStatus(err instanceof Error ? err.message : "pdr_start_failed");
    }
  }

  const mapSrc = useMemo(() => {
    if (!session) return "";
    const u = new URL(INDOOR_MAP_URL, window.location.href);
    u.searchParams.set("airport", clientDefaultAirport().iata);
    u.searchParams.set("tenant", session.passenger.tenantId);
    u.searchParams.set("mapRole", "passenger");
    u.searchParams.set("apiBase", INDOOR_MAP_API_BASE);
    u.searchParams.set("gateFrom", session.passenger.gateId);
    u.searchParams.set("gateTo", session.passenger.gateId);
    u.searchParams.set("dep", session.passenger.flightId);
    u.searchParams.set("pax", session.passenger.id);
    u.searchParams.set("parentOrigin", window.location.origin);
    return u.toString();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    setPdrPlannedPath(null);
    setPdrHasRoute(false);
    const activeSession = session;
    function handleMapMessage(ev: MessageEvent) {
      if (ev.source !== mapFrameRef.current?.contentWindow) return;
      const data = ev.data as { type?: string; position?: unknown; path?: unknown; pathSteps?: unknown } | null;
      if (!data) return;
      if (data.type === "orienta-nav-path-debug") {
        const steps = Array.isArray(data.pathSteps) ? data.pathSteps.length : 0;
        setNavDebug(`${steps} route steps loaded`);
        return;
      }
      if (data.type === "orienta-nav-path-lonlat") {
        if (isLngLatPath(data.path) && !pdrActiveRef.current && !isPdrSessionActive()) {
          setPdrPlannedPath(data.path.map(([lng, lat]) => ({ lat, lng })));
          setPdrHasRoute(true);
        }
        return;
      }
      if (data.type !== "orienta-pax-trajectory" || !isLatLng(data.position)) return;
      if (pdrActiveRef.current || isPdrSessionActive()) return;
      const pathRaw = Array.isArray(data.path) ? data.path : [];
      const path = pathRaw.filter(isLatLng);
      const position = data.position;
      realtimeRef.current?.sendTrajectory(path.length ? path : [position], position);
      postPaxFallback(activeSession, "/api/pax/tourist-position", {
        lat: position.lat,
        lng: position.lng,
        path: path.length ? path : [position],
      });
      lastTrajectoryAtRef.current = Date.now();
      setLocationStatus(`Live position shared at ${fmtTime(Date.now())}.`);
    }

    const pullTimer = window.setInterval(() => {
      if (pdrActiveRef.current || isPdrSessionActive()) return;
      if (Date.now() - lastTrajectoryAtRef.current < 1000) return;
      const w = mapFrameRef.current?.contentWindow as
        | (Window & {
            orientaDumpTouristPosition?: () => unknown;
            orientaGetTouristPositionHistory?: () => unknown;
          })
        | undefined;
      if (!w || typeof w.orientaDumpTouristPosition !== "function") return;
      try {
        const position = w.orientaDumpTouristPosition();
        if (!isLatLng(position)) return;
        const history =
          typeof w.orientaGetTouristPositionHistory === "function"
            ? w.orientaGetTouristPositionHistory()
            : null;
        const path = Array.isArray(history) ? history.filter(isLatLng).slice(-40) : [];
        realtimeRef.current?.sendTrajectory(path.length ? path : [position], position);
        postPaxFallback(activeSession, "/api/pax/tourist-position", {
          lat: position.lat,
          lng: position.lng,
          path: path.length ? path : [position],
        });
        lastTrajectoryAtRef.current = Date.now();
      } catch {
        /* ignore */
      }
    }, 1000);

    window.addEventListener("message", handleMapMessage);
    return () => {
      window.removeEventListener("message", handleMapMessage);
      window.clearInterval(pullTimer);
    };
  }, [session]);

  function sendChat() {
    const body = input.trim();
    if (!body || !canChat) return;
    realtimeRef.current?.chatSend(body);
    setInput("");
  }

  function shareLocation() {
    if (!session || !canShareLocation) return;
    const body = `Passenger reports current target gate: ${session.passenger.gateId}`;
    realtimeRef.current?.chatSend(body, "location", session.passenger.gateId);
    setLocationStatus(
      `Location share requested near ${session.passenger.gateId}. Live map position will update automatically when available.`,
    );
  }

  function submitRobotRequest() {
    if (!session || robotPhase !== "idle") return;
    const service = ROBOT_SERVICES.find((s) => s.id === robotService);
    const summary = [
      `[Robot request] ${service?.title || robotService}`,
      `Party: ${robotParty}`,
      `From: ${robotOrigin}`,
      `To: ${robotDestination}`,
      robotNote.trim() ? `Note: ${robotNote.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    // Notify ops over chat when allowed; free sessions still get local tracking UX.
    if (canChat) realtimeRef.current?.chatSend(summary);
    postPaxFallback(session, "/api/pax/presence", {
      online: true,
      robotRequest: {
        serviceType: robotService,
        partySize: robotParty,
        origin: robotOrigin,
        destination: robotDestination,
        note: robotNote.trim(),
        at: Date.now(),
      },
    });
    setRobotPhase("submitted");
    setRobotOpen(true);
    setChat((prev) => [
      ...prev,
      {
        id: `local-robot-${Date.now()}`,
        passengerId: session.passenger.id,
        tenantId: session.passenger.tenantId,
        from: "system",
        body: `已提交机器人服务请求：${service?.title || robotService}。调度员确认后将通过本页与你沟通。`,
        createdAt: Date.now(),
        kind: "text",
      },
    ]);
  }

  function resetRobotRequest() {
    setRobotPhase("idle");
    setRobotNote("");
  }

  function logout() {
    stopPdrSession();
    realtimeRef.current?.close();
    clearPaxSession();
    window.location.href = "/pax";
  }

  function focusChat() {
    setUnreadChat(false);
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" });
  }

  const visibleBanners = notifications.filter((n) => !dismissedNotify.has(n.messageId)).slice(0, 3);
  const statusLabel = !rtUp ? "Offline" : session?.plan === "free" ? "Assisted" : "Connected";
  const robotPill =
    robotPhase === "idle"
      ? "未预约"
      : robotPhase === "submitted"
        ? "已提交"
        : robotPhase === "assigned"
          ? "已分配"
          : robotPhase === "en_route"
            ? "前往中"
            : "服务中";

  if (checking) {
    return (
      <div className="pax-shell pax-shell--assist" style={{ display: "grid", placeItems: "center" }}>
        Loading passenger session…
      </div>
    );
  }

  if (!session || error) {
    return (
      <div className="pax-shell pax-shell--assist" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div className="pax-card" style={{ maxWidth: 460, width: "100%" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Session required</h1>
          <p className="pax-lead">Please start from the passenger entry page. Error: {error || "missing_session"}</p>
          <a className="pax-btn" href="/pax" style={{ textAlign: "center", textDecoration: "none", display: "inline-block" }}>
            Go to /pax
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`pax-shell pax-shell--assist${robotOpen ? " robot-service-mode" : ""}`}>
      <div className="pax-assist-brand">
        <img className="pax-assist-logo" src="/airchina-logo.png" alt="Air China" />
        <div className="pax-assist-brand-actions">
          <a className="pax-btn secondary" href="/pax/flight" style={{ textDecoration: "none" }}>
            航班
          </a>
          <button type="button" className="pax-btn secondary" onClick={logout}>
            退出
          </button>
        </div>
      </div>

      <div className="pax-assist-tabs" role="tablist" aria-label="主视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assist"}
          className={`pax-assist-tab${tab === "assist" ? " active" : ""}`}
          onClick={() => setTab("assist")}
        >
          智能服务助手
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "nav"}
          className={`pax-assist-tab${tab === "nav" ? " active" : ""}`}
          onClick={() => setTab("nav")}
        >
          室内导航
        </button>
      </div>

      {!push.standalone ? (
        <div className="pax-assist-mode-warn">
          当前是浏览器标签页（有地址栏），不是独立 PWA App。请添加到主屏幕后从图标打开，手机通知与离开 30s 提醒才可用。
        </div>
      ) : null}

      <div className="pax-assist-push">
        <button
          type="button"
          className="pax-assist-push-btn"
          onClick={() => void push.enablePush()}
          disabled={push.enabled}
        >
          {push.enabled ? "通知已开启" : "开启手机通知"}
        </button>
        {push.hint ? <div className="pax-assist-push-hint">{push.hint}</div> : null}
      </div>

      {tab === "nav" ? (
        <section className="pax-assist-nav-panel">
          <div className="pax-assist-nav-hint">
            室内地图导航（非视频）。有路径后可启动 PDR。
            {navDebug ? ` · ${navDebug}` : ""}
            {pdrStatus ? ` · ${pdrStatus}` : ""}
          </div>
          <div className="pax-assist-nav-frame">
            <iframe
              ref={mapFrameRef}
              title="Passenger indoor navigation"
              src={mapSrc}
              allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write"
            />
          </div>
          <div className="pax-assist-status-row">
            <button
              type="button"
              className="pax-assist-loc-btn"
              onClick={() => void togglePdr()}
              disabled={!canShareLocation || (!pdrActive && !pdrHasRoute)}
            >
              {pdrActive ? "Stop PDR" : "Start PDR (IMU)"}
            </button>
            {pdrBackendOk === false ? <span>PDR offline</span> : null}
          </div>
        </section>
      ) : (
        <section className="pax-assist-panel">
          <div className="pax-assist-hdr">
            <span className={`pax-assist-dot${rtUp ? " online" : ""}`} />
            <div>
              <div className="pax-assist-hdr-title">{session.passenger.name || "Guest"}</div>
              <div className="pax-assist-hdr-sub">
                ({session.passenger.id}) · {session.plan === "premium" ? "Premium" : "Free"}
              </div>
            </div>
          </div>

          <div className="pax-assist-info-strip">
            <div className="pax-assist-info-item">
              <div className="pax-assist-info-label">Inbound</div>
              <div className="pax-assist-info-val">{strip.inbound}</div>
            </div>
            <div className="pax-assist-info-item">
              <div className="pax-assist-info-label">Outbound</div>
              <div className="pax-assist-info-val">{strip.outbound}</div>
            </div>
            <div className="pax-assist-info-item">
              <div className="pax-assist-info-label">Gate</div>
              <div className="pax-assist-gate">{session.passenger.gateId || "—"}</div>
            </div>
            <div className="pax-assist-info-item">
              <div className="pax-assist-info-label">Status</div>
              <div className="pax-assist-info-val">{statusLabel}</div>
            </div>
          </div>

          <div className="pax-assist-chat-head">
            <span>与 Orienta Agent 交互</span>
            {unreadChat ? <span className="pax-assist-unread-dot" aria-label="unread" /> : null}
          </div>

          {visibleBanners.map((n) => (
            <div key={n.messageId} className="pax-assist-notify-banner">
              <button
                type="button"
                className="dismiss"
                aria-label="Dismiss"
                onClick={() => setDismissedNotify((prev) => new Set(prev).add(n.messageId))}
              >
                ×
              </button>
              <b>{n.title}</b>
              <div>{n.body}</div>
            </div>
          ))}

          {unreadChat ? (
            <button type="button" className="pax-assist-chat-alert" onClick={focusChat}>
              <span className="pax-assist-chat-alert-dot" />
              <span>客服新消息</span>
              <span className="pax-assist-chat-alert-action">查看消息</span>
            </button>
          ) : null}

          <div className="pax-assist-msgs" ref={msgsRef} onScroll={() => setUnreadChat(false)}>
            <MessageList messages={chat} plan={session.plan} />
          </div>

          <section className={`pax-robot-booking${robotOpen ? " is-open" : ""}${robotPhase !== "idle" ? " is-tracking" : ""}`}>
            <div className="pax-robot-booking-head">
              <div>
                <div className="pax-robot-booking-title">预约机器人服务</div>
                {robotOpen ? (
                  <div className="pax-robot-booking-sub">
                    提交后后台调度员会确认请求、分配机器人，并继续通过本页与你沟通。
                  </div>
                ) : null}
              </div>
              <div className="pax-robot-booking-head-actions">
                {unreadChat ? (
                  <button type="button" className="pax-robot-chat-alert" onClick={focusChat}>
                    客服消息
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pax-robot-booking-toggle"
                  onClick={() => setRobotOpen((v) => !v)}
                >
                  {robotOpen ? "收起" : "展开"}
                </button>
                <span className="pax-robot-state-pill">{robotPill}</span>
              </div>
            </div>

            {!robotOpen && robotPhase !== "idle" ? (
              <div className="pax-robot-tracking-compact">请求已提交 · 等待调度确认</div>
            ) : null}

            {robotOpen && robotPhase === "idle" ? (
              <div className="pax-robot-form">
                <div className="pax-robot-service-cards" role="radiogroup" aria-label="机器人服务类型">
                  {ROBOT_SERVICES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`pax-robot-service-card${robotService === s.id ? " active" : ""}`}
                      onClick={() => setRobotService(s.id)}
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
                      value={robotParty}
                      onChange={(e) => setRobotParty(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                    />
                  </label>
                  <label>
                    当前位置 / 接应点
                    <input value={robotOrigin} onChange={(e) => setRobotOrigin(e.target.value)} />
                  </label>
                  <label>
                    目的地
                    <input value={robotDestination} onChange={(e) => setRobotDestination(e.target.value)} />
                  </label>
                </div>
                <label>
                  补充说明
                  <textarea
                    value={robotNote}
                    onChange={(e) => setRobotNote(e.target.value)}
                    placeholder="例如：需要轮椅、行动不便、随身行李较多等"
                  />
                </label>
                <button type="button" className="pax-btn" onClick={submitRobotRequest}>
                  提交预约
                </button>
              </div>
            ) : null}

            {robotOpen && robotPhase !== "idle" ? (
              <div className="pax-robot-tracking-card">
                <div className="pax-robot-track-steps">
                  {(["submitted", "assigned", "en_route", "serving"] as const).map((step, i) => {
                    const order = ["submitted", "assigned", "en_route", "serving"] as const;
                    const activeIdx = order.indexOf(robotPhase === "idle" ? "submitted" : robotPhase);
                    const done = i <= activeIdx;
                    return (
                      <div key={step} className={`pax-robot-track-step${done ? " done" : ""}`}>
                        {step === "submitted"
                          ? "已提交"
                          : step === "assigned"
                            ? "已分配"
                            : step === "en_route"
                              ? "前往中"
                              : "服务中"}
                      </div>
                    );
                  })}
                </div>
                <p className="pax-robot-booking-sub">调度确认后状态会更新；也可继续通过上方对话沟通。</p>
                <button type="button" className="pax-btn secondary" onClick={resetRobotRequest}>
                  取消 / 重新预约
                </button>
              </div>
            ) : null}
          </section>

          <div className="pax-assist-status-row">
            <span>{locationStatus}</span>
            <button type="button" className="pax-assist-loc-btn" disabled={!canShareLocation} onClick={shareLocation}>
              Share Location
            </button>
          </div>

          {canChat ? (
            <div className="pax-assist-input-area">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="Message operator…"
              />
              <button type="button" className="pax-assist-send" disabled={!input.trim()} onClick={sendChat}>
                Send
              </button>
            </div>
          ) : (
            <div className="pax-assist-input-area pax-assist-input-area--disabled">
              <div className="pax-assist-free-note">Basic 会话不能主动发起助手对话；可开启通知、分享位置并预约机器人。</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
