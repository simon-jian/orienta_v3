import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "../components/TopBar";
import MapView from "../features/map/MapView";
import PassengerCard from "../components/PassengerCard";
import ToastHost from "../components/Toast";
import ConversationPanel from "../features/chat/ConversationPanel";
import { DeparturesFids, ArrivalsFids } from "../features/fids/FidsPanel";
import DashboardTab from "../features/passengers/DashboardTab";
import RiskBadges from "../features/passengers/RiskBadges";
import { useDashboard } from "../features/passengers/useDashboard";
import { statusBadge, extStatusLabel } from "../utils/statusDisplay";

import type { Gate, Flight, PaxExtStatus, AdminSession } from "../types/types";
import { loadGates } from "../services/gateService";
import { buildPekFlights } from "../services/flightService";
import { PEK_SIM_PAX } from "../data/airports/pek";
import { logout as authLogout } from "../services/auth";
import { CLIENT_DEFAULT_AIRPORT, CLIENT_DEFAULT_TENANT, clientDefaultAirport } from "../config/client";

type DashTab = "dashboard" | "map";

// ─── Dashboard component ──────────────────────────────────────────────────────

export default function Dashboard({ session, onLogout }: { session: AdminSession; onLogout(): void }) {
  const airport = CLIENT_DEFAULT_AIRPORT;
  const tenantId = CLIENT_DEFAULT_TENANT;

  const [tab, setTab] = useState<DashTab>("dashboard");

  // Load PEK gates from POI API
  const [pekGates, setPekGates] = useState<Gate[]>([]);
  const [pekPoiReady, setPekPoiReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPekPoiReady(false);
    loadGates()
      .then(({ gates }) => { if (!cancelled) { setPekGates(gates); setPekPoiReady(true); } })
      .catch(() => { if (!cancelled) setPekPoiReady(true); });
    return () => { cancelled = true; };
  }, []);

  const gates: Gate[] = useMemo(
    () => pekPoiReady ? pekGates : [],
    [pekPoiReady, pekGates],
  );
  const flights: Flight[] = useMemo(() => buildPekFlights(), []);
  const gatesById   = useMemo(() => new Map(gates.map((g)   => [g.id, g])),   [gates]);
  const flightsById = useMemo(() => new Map(flights.map((f) => [f.id, f])), [flights]);
  // All realtime + passenger state managed by the hook
  const {
    passengers, priorityList, riskCounts,
    selectedPaxId, setSelectedPaxId,
    setHoverPaxId,
    search, setSearch,
    passengersFilteredByGate,
    mapPassengers, mapViewMode, setMapViewMode,
    rtUp, presence,
    openConvPaxId, setOpenConvPaxId,
    chatHistory,
    sendSms, sendChat, requestLocation, openConversation,
    toasts, dismissToast,
  } = useDashboard({
    tenantId, gates, flights, gatesById, flightsById,
    pekPoiReady, session,
  });

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 300;
    const v = localStorage.getItem("orienta_sidebar_width");
    const n = v ? parseInt(v, 10) : 300;
    return Number.isFinite(n) && n >= 200 && n <= 500 ? n : 300;
  });
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeStartRef.current;
      if (!r) return;
      setSidebarWidth(() => {
        const next = Math.max(200, Math.min(500, r.startW + (e.clientX - r.startX)));
        localStorage.setItem("orienta_sidebar_width", String(next));
        return next;
      });
    };
    const onUp = () => { resizeStartRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",  onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);
  const onResizeHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { startX: e.clientX, startW: sidebarWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Responsive layout
  const [isWide, setIsWide] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth >= 768);
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dockChat = tab === "map" && isWide;

  const selectedPax = useMemo(
    () => selectedPaxId ? passengers.find((p) => p.id === selectedPaxId) || null : null,
    [selectedPaxId, passengers],
  );

  const airportLabel = `国航 Demo · ${clientDefaultAirport().iata} ${clientDefaultAirport().defaultTerminal} · 国际→国际`;
  const simPax = PEK_SIM_PAX;

  // ─── Render ────────────────────────────────────────────────────────────────

  const mainStyle = {
    padding: 0, overflow: "hidden" as const,
    height: "calc(100vh - 56px)", display: "flex" as const, flexDirection: "column" as const,
  };

  return (
    <div className="app">
      <TopBar
        search={search} onSearch={setSearch}
        title="中国国际航空公司后台"
        subtitle={airportLabel}
        searchPlaceholder="搜索登机口（如 E21 / D06）…"
        gateCount={gates.length} passengerCount={passengers.length}
        transferCount={passengers.length}
        transferUrgentCount={riskCounts.red + riskCounts.yellow}
        dataSource="T3E/I→I"
        userLabel={`${session.user.displayName} · ${session.user.org}`}
        onLogout={() => { authLogout(); onLogout(); }}
        onPaxClick={() => { setMapViewMode("all"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        onUrgentClick={() => { setMapViewMode("urgent"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        mapViewFilter={mapViewMode}
        extraRight={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className={"btn" + (tab === "dashboard" ? " primary" : "")} onClick={() => setTab("dashboard")} style={{ fontSize: 12 }}>📊 Dashboard</button>
            <button className={"btn" + (tab === "map" ? " primary" : "")} onClick={() => setTab("map")} style={{ fontSize: 12 }}>🗺️ Map T3E</button>
            <span className={"pill " + (rtUp ? "ok" : "warn")} style={{ fontSize: 11 }}>{rtUp ? "WS ●" : "WS ○"}</span>
          </div>
        }
      />

      <div className="main" style={mainStyle}>
        {/* ── Dashboard tab ── */}
        <div style={{
          display: tab === "dashboard" ? "flex" : "none",
          flex: 1, minHeight: 0, overflow: "hidden", gap: 16, padding: 16, alignItems: "stretch",
        }}>
          <div style={{ flex: 1, minWidth: 220, maxWidth: 380, height: "100%", minHeight: 400 }}>
            <DeparturesFids airport={airport} />
          </div>
          <div style={{ flex: 1.5, minWidth: 400, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
            <DashboardTab
              passengers={passengersFilteredByGate}
              presence={presence}
              riskCounts={riskCounts}
              priorityList={priorityList.filter((p) => passengersFilteredByGate.some((x) => x.id === p.id))}
              onSelectPax={(id) => { setSelectedPaxId(id); setMapViewMode("single"); setTab("map"); openConversation(id); }}
              onSendSms={sendSms}
              onRequestLocation={requestLocation}
              onOpenConversation={openConversation}
              gatesById={gatesById}
              flightsById={flightsById}
            />
          </div>
          <div style={{ flex: 1, minWidth: 220, maxWidth: 380, height: "100%", minHeight: 400 }}>
            <ArrivalsFids airport={airport} />
          </div>
        </div>

        {/* ── Map tab ── */}
        <div style={{
          display: tab === "map" ? "flex" : "none",
          flex: 1, minHeight: 0, overflow: "hidden",
        }}>
          <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            <MapView
              airport={airport}
              tenantId={tenantId}
              gates={gates}
              passengers={mapPassengers}
              selectedPassengerId={selectedPaxId}
              onSelectPassenger={(id) => {
                const next = id === selectedPaxId ? null : id;
                setSelectedPaxId(next);
                setMapViewMode(next ? "single" : "all");
              }}
              onHoverPassenger={setHoverPaxId}
              visible={tab === "map"}
            />
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={onResizeHandleMouseDown}
            style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "rgba(255,255,255,0.06)", transition: "background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(10,132,255,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            title="Drag to resize"
          />

          {/* Sidebar */}
          <div className="sidebar" style={{ width: sidebarWidth, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", height: "100%" }}>
            {selectedPax ? (
              <PassengerCard
                passenger={selectedPax}
                gate={gatesById.get(selectedPax.gateId) || null}
                flight={flightsById.get(selectedPax.flightId) || null}
                onSendSms={(msg) => sendSms(selectedPax.id, msg)}
                onOpenChat={() => openConversation(selectedPax.id)}
                realtimeInfo={{ rtUp, online: !!presence[selectedPax.id], lastMessage: null }}
              />
            ) : (
              <div className="card card-placeholder">
                <h3>Transfer Control · {airport}</h3>
                <RiskBadges counts={riskCounts} />
                <div className="hr" />
                <div className="small">Click a passenger marker to view details.</div>
              </div>
            )}

            {/* Priority List */}
            <div className="card card-priority" style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: 13 }}>🔴 Priority List</h3>
              {priorityList.length === 0 && <div className="small" style={{ opacity: 0.5 }}>No urgent passengers.</div>}
              {priorityList.map((p) => (
                <button key={p.id} className="btn"
                  onClick={() => { setSelectedPaxId(p.id); setMapViewMode("single"); setTab("map"); openConversation(p.id); }}
                  style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, width: "100%" }}>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusBadge(p.extStatus), display: "inline-block" }} />
                    <b style={{ fontSize: 12 }}>{p.name}</b>
                    <span className="small">({p.id})</span>
                  </span>
                  <span className="small">{extStatusLabel(p.extStatus as PaxExtStatus)}</span>
                </button>
              ))}
            </div>

            {/* Pax Simulator */}
            <div className="card card-sim" style={{ fontSize: 12, marginTop: 10, flexGrow: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🧪 Pax Simulator</div>
              <div style={{ opacity: 0.7, marginBottom: 8, fontSize: 11 }}>
                Open passenger frontend. TX1 = <b>Siyao Fu</b>（初始离线，需在前端登录上线）。
              </div>
              {simPax.map(({ id, name, plan, note }) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: presence[id] ? "#34c759" : "#636366", display: "inline-block" }} />
                      <span style={{ fontWeight: 600 }}>{name}</span>
                    </span>
                    <span className="small" style={{ marginLeft: 4, opacity: 0.6 }}>({id})</span>
                    <div className="small" style={{ color: plan === "Premium" ? "#0a84ff" : "#636366" }}>
                      {plan === "Premium" ? "💎" : "🤖"} {presence[id] ? "Online" : "Offline"} · {note}
                    </div>
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 10, padding: "4px 10px", flexShrink: 0, marginLeft: 6 }}
                    onClick={() => { setSelectedPaxId(id); setTab("map"); openConversation(id); }}>
                    Open ↗
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Docked chat panel (desktop, map view) */}
          {dockChat && openConvPaxId && (
            <div style={{ width: 320, flexShrink: 0, overflow: "hidden", height: "100%", minHeight: 0, padding: 10 }}>
              <ConversationPanel
                mode="docked"
                passengerId={openConvPaxId}
                passenger={passengers.find((p) => p.id === openConvPaxId) || null}
                history={chatHistory[openConvPaxId] || []}
                onSend={(body) => sendChat(openConvPaxId, body)}
                onRequestLocation={() => requestLocation(openConvPaxId)}
                onClose={() => setOpenConvPaxId(null)}
                isOnline={!!presence[openConvPaxId]}
                isPremium={passengers.find((p) => p.id === openConvPaxId)?.plan === "premium"}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile / narrow: floating chat overlay */}
      {openConvPaxId && !dockChat && (
        <ConversationPanel
          mode="floating"
          passengerId={openConvPaxId}
          passenger={passengers.find((p) => p.id === openConvPaxId) || null}
          history={chatHistory[openConvPaxId] || []}
          onSend={(body) => sendChat(openConvPaxId, body)}
          onRequestLocation={() => requestLocation(openConvPaxId)}
          onClose={() => setOpenConvPaxId(null)}
          isOnline={!!presence[openConvPaxId]}
          isPremium={passengers.find((p) => p.id === openConvPaxId)?.plan === "premium"}
        />
      )}

      <ToastHost items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
