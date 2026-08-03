import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, MsgRecord } from "../../types/types";
import { INDOOR_MAP_API_BASE, INDOOR_MAP_URL } from "../../config/indoorMap";
import { connectPaxRealtime, type PaxRealtime } from "../../services/realtime";
import {
  checkPdrBackendAvailable,
  configurePdrSession,
  isPdrSessionActive,
  startPdrSession,
  stopPdrSession,
  type PdrTrajectoryUpdate,
} from "../../services/pdrClient";
import { getGateCoord as getPoiGateCoord, preloadPoi, getCenter as getPoiCenter } from "../../services/poi/PoiService";
import {
  clearPaxSession,
  fetchPaxSession,
  getStoredPaxSession,
  type PaxSession,
} from "./session";
import { apiUrl } from "../../config/api";
import { clientDefaultAirport } from "../../config/client";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (!messages.length) {
    return <div className="small" style={{ opacity: 0.55, textAlign: "center", padding: 16 }}>No conversation yet.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {messages.map((m) => {
        const own = m.from === "pax";
        return (
          <div key={m.id} style={{ alignSelf: own ? "flex-end" : "flex-start", maxWidth: "82%" }}>
            <div className="small" style={{ opacity: 0.55, marginBottom: 2 }}>
              {own ? "You" : m.from} · {fmtTime(m.createdAt)}
            </div>
            <div style={{
              padding: "8px 10px",
              borderRadius: 12,
              background: own ? "#c8102e" : m.from === "system" ? "#fff7ed" : "#fff",
              color: own ? "#fff" : "#111827",
              border: own ? undefined : "1px solid rgba(0,0,0,0.08)",
              fontSize: 13,
              lineHeight: 1.45,
            }}>
              {m.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function capabilityLabel(capability: string): string {
  const labels: Record<string, string> = {
    navigate: "Navigation",
    receive_notifications: "Notifications",
    share_location: "Location sharing",
    operator_chat: "Operator chat",
  };
  return labels[capability] || capability;
}

function isLatLng(value: unknown): value is { lat: number; lng: number } {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  return !!v && typeof v.lat === "number" && typeof v.lng === "number";
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
  const [input, setInput] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [navDebug, setNavDebug] = useState("");
  const [pdrStatus, setPdrStatus] = useState("");
  const [pdrActive, setPdrActive] = useState(false);
  const [pdrBackendOk, setPdrBackendOk] = useState<boolean | null>(null);
  const [poiReady, setPoiReady] = useState(false);
  const realtimeRef = useRef<PaxRealtime | null>(null);
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lastTrajectoryAtRef = useRef(0);
  const pdrActiveRef = useRef(false);

  const canChat = !!session?.capabilities.includes("operator_chat");
  const canShareLocation = !!session?.capabilities.includes("share_location");

  useEffect(() => {
    let cancelled = false;
    const stored = getStoredPaxSession();
    if (!stored?.token) {
      setChecking(false);
      setError("missing_session");
      return;
    }
    fetchPaxSession(stored.token)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "session_invalid"); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
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
      onChatMsg: (msg) => setChat((prev) => [...prev, msg]),
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
    preloadPoi()
      .then(() => { if (!cancelled) setPoiReady(true); })
      .catch(() => { if (!cancelled) setPoiReady(true); });
    checkPdrBackendAvailable()
      .then((ok) => { if (!cancelled) setPdrBackendOk(ok); })
      .catch(() => { if (!cancelled) setPdrBackendOk(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    pdrActiveRef.current = pdrActive;
  }, [pdrActive]);

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
    if (!session || !poiReady) return;
    const gateCoord = getPoiGateCoord(session.passenger.gateId);
    const anchor = gateCoord ?? getPoiCenter();

    void configurePdrSession({
      anchor,
      passengerId: session.passenger.id,
      onStatus: setPdrStatus,
      onTrajectory: (update) => relayTrajectory(session, update),
      postToMap: (update) => {
        const win = mapFrameRef.current?.contentWindow;
        if (!win) return;
        let origin = window.location.origin;
        try {
          origin = new URL(mapFrameRef.current?.src || INDOOR_MAP_URL, window.location.href).origin;
        } catch { /* ignore */ }
        win.postMessage({
          type: "orienta-pax-map-position",
          source: "pdr",
          position: update.position,
          path: update.path,
          headingRad: update.headingRad,
        }, origin);
      },
    });

    return () => {
      stopPdrSession();
      setPdrActive(false);
    };
  }, [session, poiReady]);

  async function togglePdr() {
    if (isPdrSessionActive()) {
      stopPdrSession();
      setPdrActive(false);
      setPdrStatus("");
      return;
    }
    if (pdrBackendOk === false) {
      setPdrStatus("PDR backend unavailable — set PDR_API_ORIGIN and start PDR_AIRCHINA on port 10000");
      return;
    }
    try {
      await startPdrSession();
      setPdrActive(isPdrSessionActive());
    } catch (err) {
      setPdrStatus(err instanceof Error ? err.message : "pdr_start_failed");
    }
  }

  const sortedNotifications = useMemo(
    () => [...notifications].sort((a, b) => b.createdAt - a.createdAt),
    [notifications],
  );

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
    const anchor = getPoiGateCoord(session.passenger.gateId);
    if (anchor) {
      u.searchParams.set("pdrOriginLat", String(anchor.lat));
      u.searchParams.set("pdrOriginLng", String(anchor.lng));
    }
    return u.toString();
    // poiReady doesn't appear in the body directly, but getPoiGateCoord reads
    // a module-level cache that PoiService populates asynchronously — poiReady
    // is the React-visible signal to recompute once that cache is filled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, poiReady]);

  useEffect(() => {
    if (!session) return;
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
        const history = typeof w.orientaGetTouristPositionHistory === "function"
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
        /* ignore cross-frame timing errors */
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
    setLocationStatus(`Location share requested near ${session.passenger.gateId}. Live map position will update automatically when available.`);
  }

  function logout() {
    stopPdrSession();
    realtimeRef.current?.close();
    clearPaxSession();
    window.location.href = "/pax";
  }

  if (checking) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading passenger session...</div>;
  }

  if (!session || error) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f6fa", padding: 24 }}>
        <div className="card" style={{ maxWidth: 460, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Session required</h1>
          <p className="small">Please start from the passenger entry page. Error: {error || "missing_session"}</p>
          <a className="btn primary" href="/pax" style={{ textAlign: "center", textDecoration: "none" }}>Go to /pax</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", color: "#111827" }}>
      <header style={{ background: "#c8102e", color: "#fff", padding: "14px 18px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 800 }}>Orienta Passenger</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {session.passenger.name} · {session.passenger.flightId} · Gate {session.passenger.gateId}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="pill" style={{ color: "#111827", background: "#fff" }}>{session.accountType}</span>
          <span className="pill" style={{ color: "#111827", background: "#fff" }}>{session.plan}</span>
          <span className="pill" style={{ color: "#111827", background: "#fff" }}>{rtUp ? "WS online" : "WS offline"}</span>
          <button className="btn" onClick={logout}>Exit</button>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10, gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Navigation</h2>
          <div className="small">All passenger sessions include navigation.</div>
          <div style={{ padding: 12, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,0.08)" }}>
            <div className="small">Current trip</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{session.passenger.flightId}</div>
            <div>Proceed to Gate <b>{session.passenger.gateId}</b></div>
          </div>
          <div style={{ height: 460, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.10)", background: "#111" }}>
            <iframe
              ref={mapFrameRef}
              title="Passenger indoor navigation"
              src={mapSrc}
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
              allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write"
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className={"btn" + (pdrActive ? " primary" : "")}
              onClick={() => void togglePdr()}
              disabled={!canShareLocation}
            >
              {pdrActive ? "Stop PDR" : "Start PDR (IMU)"}
            </button>
            {pdrBackendOk === false ? (
              <span className="small" style={{ color: "#b45309" }}>
                PDR service offline — run PDR_AIRCHINA and set PDR_API_ORIGIN
              </span>
            ) : null}
            {pdrStatus ? <span className="small">{pdrStatus}</span> : null}
            {navDebug ? <span className="small" style={{ alignSelf: "center" }}>{navDebug}</span> : null}
          </div>
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Capabilities</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {session.capabilities.map((cap) => (
              <div key={cap} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 6 }}>
                <span>{capabilityLabel(cap)}</span>
                <b>Enabled</b>
              </div>
            ))}
          </div>
          <button className="btn" disabled={!canShareLocation} onClick={shareLocation}>
            Share current location
          </button>
          {locationStatus ? <div className="small">{locationStatus}</div> : null}
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Notifications</h2>
          {sortedNotifications.length === 0 ? (
            <div className="small" style={{ opacity: 0.55 }}>No operator notifications yet.</div>
          ) : sortedNotifications.map((n) => (
            <div key={n.messageId} style={{ padding: 10, borderRadius: 10, background: "#fff", border: "1px solid rgba(0,0,0,0.08)" }}>
              <b>{n.title}</b>
              <div className="small">{fmtTime(n.createdAt)} · {n.status}</div>
              <div style={{ marginTop: 4 }}>{n.body}</div>
            </div>
          ))}
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 420 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Operator Communication</h2>
          {!canChat ? (
            <div className="small">Basic sessions can receive messages and share location, but cannot start free-text operator chat.</div>
          ) : (
            <div className="small">Premium sessions can chat directly with an operator.</div>
          )}
          <div style={{ flex: 1, overflow: "auto", minHeight: 220, padding: 10, background: "#f9fafb", borderRadius: 12 }}>
            <MessageList messages={chat} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              className="input"
              value={input}
              disabled={!canChat}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder={canChat ? "Message operator..." : "Chat disabled for Basic sessions"}
              style={{ flex: 1, minHeight: 54, resize: "vertical" }}
            />
            <button className="btn primary" disabled={!canChat || !input.trim()} onClick={sendChat}>Send</button>
          </div>
        </section>
      </main>
    </div>
  );
}
