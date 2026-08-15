import { useCallback, useEffect, useState } from "react";
import {
  clearPaxSession,
  fetchPaxSession,
  getStoredPaxSession,
  type PaxSession,
} from "./session";
import { usePaxPush } from "./hooks/usePaxPush";
import { usePaxRealtimeSession } from "./hooks/usePaxRealtimeSession";
import { usePdrNavigation } from "./hooks/usePdrNavigation";
import { useAssistInfoStrip } from "./hooks/useAssistInfoStrip";
import { AssistInfoStrip } from "./assist/AssistInfoStrip";
import { AssistChatPanel } from "./assist/AssistChatPanel";
import { AssistNavPanel } from "./assist/AssistNavPanel";
import { RobotBookingPanel } from "./assist/RobotBookingPanel";
import type { AssistTab } from "./assist/assistTypes";
import {
  clearConfirmedNavPlan,
  getConfirmedNavPlan,
  getNavHints,
  saveConfirmedNavPlan,
  saveNavHints,
  type NavPlanConfirmed,
  type NavPlanHints,
} from "./assist/navPlan";
import { clientDefaultAirportId } from "../../config/client";
import "./styles/pax.css";

function initialAssistTab(): AssistTab {
  try {
    return new URLSearchParams(window.location.search).get("tab") === "nav" ? "nav" : "assist";
  } catch {
    return "assist";
  }
}

function hintsFromUrlAndStorage(session: PaxSession | null): NavPlanHints {
  const stored = getNavHints() || {};
  let urlHints: NavPlanHints = {};
  try {
    const q = new URLSearchParams(window.location.search);
    urlHints = {
      airport: q.get("airport") || undefined,
      fromGateHint: q.get("from") || undefined,
      toGateHint: q.get("to") || undefined,
    };
  } catch {
    /* ignore */
  }
  return {
    airport: urlHints.airport || stored.airport || clientDefaultAirportId(),
    fromGateHint: urlHints.fromGateHint || stored.fromGateHint,
    toGateHint: urlHints.toGateHint || stored.toGateHint || session?.passenger.gateId,
    flightId: stored.flightId || session?.passenger.flightId,
  };
}

export default function PaxAppPage() {
  const [session, setSession] = useState<PaxSession | null>(() => getStoredPaxSession());
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AssistTab>(() => initialAssistTab());
  const [robotOpen, setRobotOpen] = useState(false);
  const [navPlan, setNavPlan] = useState<NavPlanConfirmed | null>(() => getConfirmedNavPlan());
  const [navHints, setNavHints] = useState<NavPlanHints>(() => hintsFromUrlAndStorage(getStoredPaxSession()));
  const push = usePaxPush(session);

  const {
    rtUp,
    presenceOk,
    chat,
    notifications,
    unreadChat,
    setUnreadChat,
    locationStatus,
    setLocationStatus,
    liveRobotRequest,
    realtimeRef,
    sendChat,
    shareLocation,
  } = usePaxRealtimeSession(session);

  const onLocationStatus = useCallback((text: string) => setLocationStatus(text), [setLocationStatus]);
  const nav = usePdrNavigation(session, realtimeRef, onLocationStatus, navPlan);

  useEffect(() => {
    if (!session) return;
    setNavHints((prev) => {
      const next = hintsFromUrlAndStorage(session);
      return {
        airport: prev.airport || next.airport,
        fromGateHint: prev.fromGateHint || next.fromGateHint,
        toGateHint: prev.toGateHint || next.toGateHint,
        flightId: prev.flightId || next.flightId,
      };
    });
  }, [session]);
  const strip = useAssistInfoStrip(session, rtUp, presenceOk);
  const linkUp = rtUp || presenceOk;

  // Any valid session can chat (free→AI, premium→operator). Don't gate the
  // textarea on a possibly-stale capabilities[] from sessionStorage.
  const canChat = !!session;
  const canShareLocation =
    !!session?.capabilities?.includes("share_location") || !!session;

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
        // Avoid replacing an equivalent session object — that remounts WS/presence
        // and makes Status flap Online/Offline. Still refresh capabilities/meta.
        setSession((prev) => {
          if (
            prev &&
            prev.token === s.token &&
            prev.passenger.id === s.passenger.id &&
            prev.plan === s.plan &&
            prev.passenger.gateId === s.passenger.gateId &&
            prev.passenger.flightId === s.passenger.flightId
          ) {
            const sameCaps =
              JSON.stringify(prev.capabilities || []) === JSON.stringify(s.capabilities || []);
            if (
              sameCaps &&
              prev.accountType === s.accountType &&
              prev.passenger.name === s.passenger.name &&
              prev.expiresAt === s.expiresAt
            ) {
              return prev;
            }
            return { ...prev, ...s, trip: prev.trip || s.trip, capabilities: s.capabilities || prev.capabilities || [] };
          }
          return s;
        });
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

  function logout() {
    nav.stop();
    realtimeRef.current?.close();
    clearPaxSession();
    window.location.href = "/pax";
  }

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
        <AssistNavPanel
          plan={navPlan}
          hints={navHints}
          onConfirmPlan={(plan) => {
            saveConfirmedNavPlan(plan);
            saveNavHints({
              airport: plan.airport,
              fromGateHint: plan.fromLabel,
              toGateHint: plan.toLabel,
              flightId: navHints.flightId,
            });
            setNavPlan(plan);
          }}
          onChangePlan={() => {
            nav.stop();
            clearConfirmedNavPlan();
            setNavPlan(null);
          }}
          mapSrc={nav.mapSrc}
          mapFrameRef={nav.mapFrameRef}
          navDebug={nav.navDebug}
          pdrStatus={nav.pdrStatus}
          pdrActive={nav.pdrActive}
          pdrBackendOk={nav.pdrBackendOk}
          pdrHasRoute={nav.pdrHasRoute}
          routePlanning={nav.routePlanning}
          canShareLocation={canShareLocation}
          onTogglePdr={() => void nav.togglePdr()}
        />
      ) : (
        <section className="pax-assist-panel">
          <div className="pax-assist-hdr">
            <span className={`pax-assist-dot${linkUp ? " online" : ""}`} />
            <div>
              <div className="pax-assist-hdr-title">{session.passenger.name || "Guest"}</div>
              <div className="pax-assist-hdr-sub">
                ({session.passenger.id}) · {session.plan === "premium" ? "Premium" : "Free"}
              </div>
            </div>
          </div>

          <AssistInfoStrip strip={strip} />

          <RobotBookingPanel
            session={session}
            unreadChat={unreadChat}
            liveRequest={liveRobotRequest}
            onFocusChat={() => setUnreadChat(false)}
            onOpenChange={setRobotOpen}
          />

          <AssistChatPanel
            plan={session.plan}
            canChat={canChat}
            canShareLocation={canShareLocation}
            chat={chat}
            notifications={notifications}
            unreadChat={unreadChat}
            locationStatus={locationStatus}
            onClearUnread={() => setUnreadChat(false)}
            onSendChat={sendChat}
            onShareLocation={() => shareLocation(session.passenger.gateId)}
          />
        </section>
      )}
    </div>
  );
}
