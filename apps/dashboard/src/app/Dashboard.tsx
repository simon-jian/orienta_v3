import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "../components/TopBar";
import MapView from "../features/map/MapView";
import PassengerCard from "../components/PassengerCard";
import ToastHost from "../components/Toast";
import SectionErrorBoundary from "../components/SectionErrorBoundary";
import ConversationPanel from "../features/chat/ConversationPanel";
import { DeparturesFids, ArrivalsFids } from "../features/fids/FidsPanel";
import DashboardTab from "../features/passengers/DashboardTab";
import RiskBadges from "../features/passengers/RiskBadges";
import { RobotRequestQueue } from "../features/passengers/RobotRequestQueue";
import InvitesPanel from "../features/passengers/InvitesPanel";
import { useDashboard } from "../features/passengers/useDashboard";
import { statusBadge, extStatusLabel } from "../utils/statusDisplay";

import type { Gate, Flight, PaxExtStatus, AdminSession } from "../types/types";
import { loadGates } from "../services/poi/PoiService";
import { buildFlights } from "../services/flightService";
import { logout as authLogout } from "../services/auth";
import { clientDefaultAirportId, clientDefaultTenantId, clientDefaultAirport } from "../config/client";
import { CONSOLE_TITLE } from "../config/branding";
import { INDOOR_AIRPORTS, findIndoorAirport } from "../config/indoorAirports";

type DashTab = "dashboard" | "map" | "invites";

const AIRPORT_STORAGE_KEY = "orienta_admin_airport";

function initialAirport(): string {
  const fallback = clientDefaultAirportId();
  if (typeof window === "undefined") return fallback;
  const stored = localStorage.getItem(AIRPORT_STORAGE_KEY);
  return findIndoorAirport(stored)?.code || fallback;
}

// ─── Dashboard component ──────────────────────────────────────────────────────

export default function Dashboard({ session, onLogout }: { session: AdminSession; onLogout(): void }) {
  // Which airport the operator is looking at. The map iframe used to be pinned
  // to the tenant's default while its own internal dropdown could show another
  // one, so React and the map disagreed about where passengers were.
  const [airport, setAirport] = useState<string>(initialAirport);
  const tenantId = clientDefaultTenantId();

  const [tab, setTab] = useState<DashTab>("dashboard");

  // Gates from the POI API for the selected airport. Airports the indoor map
  // knows but the tenant hasn't configured fall back to the tenant's own gates
  // (see PoiService.resolve) — the map itself still shows the right POIs.
  const [pekGates, setPekGates] = useState<Gate[]>([]);
  const [pekPoiReady, setPekPoiReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Deliberately not resetting pekPoiReady here: useDashboard treats its
    // rising edge as "first load done" and wipes live trajectories, which would
    // blank the operator's map on every airport switch.
    loadGates(airport)
      .then(({ gates }) => { if (!cancelled) { setPekGates(gates); setPekPoiReady(true); } })
      .catch(() => { if (!cancelled) setPekPoiReady(true); });
    return () => { cancelled = true; };
  }, [airport]);

  const gates: Gate[] = useMemo(
    () => pekPoiReady ? pekGates : [],
    [pekPoiReady, pekGates],
  );
  const flights: Flight[] = useMemo(() => buildFlights(airport), [airport]);
  const gatesById   = useMemo(() => new Map(gates.map((g)   => [g.id, g])),   [gates]);
  const flightsById = useMemo(() => new Map(flights.map((f) => [f.id, f])), [flights]);
  // All realtime + passenger state managed by the hook
  const {
    passengers, priorityList, riskCounts,
    passengersLoadError,
    selectedPaxId, setSelectedPaxId,
    setHoverPaxId,
    search, setSearch,
    passengersFilteredByGate,
    mapPassengers, mapViewMode, setMapViewMode,
    rtUp, presence,
    openConvPaxId, setOpenConvPaxId,
    chatHistory,
    sendSms, sendChat, requestLocation, openConversation, removePassenger,
    toasts, dismissToast,
    robotRequests, advanceRobotRequest, cancelRobotRequest,
  } = useDashboard({
    tenantId, gates, flights, gatesById, flightsById,
    pekPoiReady, session,
  });

  // Erasing a passenger is admin-only server-side (routes/passengers.ts), so
  // ops/viewer seats don't get the button at all.
  const canErasePassengers = session.user.role === "admin";

  async function confirmRemovePassenger(passengerId: string) {
    const pax = passengers.find((p) => p.id === passengerId);
    const label = pax?.name ? `${pax.name}（${passengerId}）` : passengerId;
    if (!window.confirm(`删除旅客 ${label}？\n\n聊天记录、推送订阅和登录会话会一并清除，且无法恢复。`)) {
      return;
    }
    const result = await removePassenger(passengerId);
    if (!result.ok) {
      const reason =
        result.error === "forbidden"
          ? "当前账号无权删除旅客（需要管理员角色）。"
          : "删除失败，请稍后重试。";
      window.alert(reason);
    }
  }

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

  const airportLabel = `${airport} ${clientDefaultAirport().defaultTerminal} · 国际→国际`;

  const selectAirport = (code: string) => {
    setAirport(code);
    try {
      localStorage.setItem(AIRPORT_STORAGE_KEY, code);
    } catch {
      /* private browsing — the selection just won't persist */
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const mainStyle = {
    padding: 0, overflow: "hidden" as const,
    height: "calc(100vh - 56px)", display: "flex" as const, flexDirection: "column" as const,
  };

  return (
    <div className="app">
      <TopBar
        search={search} onSearch={setSearch}
        title={CONSOLE_TITLE}
        subtitle={airportLabel}
        searchPlaceholder="搜索姓名 / ID / 航班 / 登机口…"
        gateCount={gates.length} passengerCount={passengers.length}
        transferCount={passengers.length}
        transferUrgentCount={riskCounts.red + riskCounts.yellow}
        dataSource={`${clientDefaultAirport().defaultTerminal}/I→I`}
        userLabel={`${session.user.displayName} · ${session.user.org}`}
        onLogout={() => { authLogout(); onLogout(); }}
        onPaxClick={() => { setMapViewMode("all"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        onUrgentClick={() => { setMapViewMode("urgent"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        mapViewFilter={mapViewMode}
        extraRight={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              className="btn"
              value={airport}
              onChange={(e) => selectAirport(e.target.value)}
              style={{ fontSize: 12 }}
              title="地图机场"
              aria-label="地图机场"
            >
              {INDOOR_AIRPORTS.map((a) => (
                <option key={a.code} value={a.code}>{a.label}</option>
              ))}
            </select>
            <button className={"btn" + (tab === "dashboard" ? " primary" : "")} onClick={() => setTab("dashboard")} style={{ fontSize: 12 }}>📊 Dashboard</button>
            <button className={"btn" + (tab === "map" ? " primary" : "")} onClick={() => setTab("map")} style={{ fontSize: 12 }}>🗺️ Map {clientDefaultAirport().defaultTerminal}</button>
            <button className={"btn" + (tab === "invites" ? " primary" : "")} onClick={() => setTab("invites")} style={{ fontSize: 12 }}>🔗 旅客链接</button>
            <span className={"pill " + (rtUp ? "ok" : "warn")} style={{ fontSize: 11 }}>{rtUp ? "WS ●" : "WS ○"}</span>
            {passengersLoadError && (
              <span className="pill warn" style={{ fontSize: 11 }} title="乘客列表拉取失败，当前显示的可能是过期数据">
                乘客数据可能过期
              </span>
            )}
          </div>
        }
      />

      <div className="main" style={mainStyle}>
        {/* ── Dashboard tab ── */}
        {/*
          flexWrap + min()-clamped minWidth: on any viewport wide enough for
          the original fixed minWidths (~900px+, true for every normal
          desktop/tablet size), this renders pixel-identical to before —
          min(220px, 100%) is just 220px once 100% >= 220px. Only on a
          narrower viewport (previously: hard horizontal overflow, no way to
          see the third column without scrolling sideways) do columns now
          shrink-to-fit and wrap instead.
        */}
        <div style={{
          display: tab === "dashboard" ? "flex" : "none",
          flex: 1, minHeight: 0, overflow: "auto", flexWrap: "wrap", gap: 16, padding: 16, alignItems: "stretch",
        }}>
          <div style={{ flex: "1 1 260px", minWidth: "min(220px, 100%)", maxWidth: 380, height: "100%", minHeight: 400 }}>
            <SectionErrorBoundary label="出发航班板">
              <DeparturesFids airport={airport} />
            </SectionErrorBoundary>
          </div>
          <div style={{ flex: "1.5 1 320px", minWidth: "min(400px, 100%)", minHeight: 400, overflow: "auto", display: "flex", flexDirection: "column" }}>
            <RobotRequestQueue
              requests={robotRequests}
              onOpen={(id) => {
                setSelectedPaxId(id);
                openConversation(id);
              }}
              onAdvance={advanceRobotRequest}
              onCancel={cancelRobotRequest}
            />
            <DashboardTab
              passengers={passengersFilteredByGate}
              presence={presence}
              riskCounts={riskCounts}
              priorityList={priorityList.filter((p) => passengersFilteredByGate.some((x) => x.id === p.id))}
              onSelectPax={(id) => { setSelectedPaxId(id); setMapViewMode("single"); setTab("map"); openConversation(id); }}
              onSendSms={sendSms}
              onRequestLocation={requestLocation}
              onOpenConversation={openConversation}
              onDeletePax={canErasePassengers ? (id) => void confirmRemovePassenger(id) : undefined}
              gatesById={gatesById}
              flightsById={flightsById}
            />
          </div>
          <div style={{ flex: "1 1 260px", minWidth: "min(220px, 100%)", maxWidth: 380, height: "100%", minHeight: 400 }}>
            <SectionErrorBoundary label="到达航班板">
              <ArrivalsFids airport={airport} />
            </SectionErrorBoundary>
          </div>
        </div>

        {/* ── Invites tab ── */}
        {tab === "invites" && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SectionErrorBoundary label="旅客链接">
              <InvitesPanel tenantId={tenantId} />
            </SectionErrorBoundary>
          </div>
        )}

        {/* ── Map tab ── */}
        <div style={{
          display: tab === "map" ? "flex" : "none",
          flex: 1, minHeight: 0, overflow: "hidden",
        }}>
          <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            <SectionErrorBoundary label="地图">
              <MapView
                airport={airport}
                tenantId={tenantId}
                gates={gates}
                passengers={mapPassengers}
                selectedPassengerId={selectedPaxId}
                onSelectPassenger={(id) => {
                  setSelectedPaxId(id);
                  setMapViewMode("single");
                  openConversation(id);
                }}
                onHoverPassenger={setHoverPaxId}
                visible={tab === "map"}
              />
            </SectionErrorBoundary>
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={onResizeHandleMouseDown}
            style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "rgba(255,255,255,0.06)", transition: "background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(10,132,255,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            title="Drag to resize"
          />

          {/* Sidebar — clamped to the viewport so the drag-resizable width
              (200-500px, desktop-oriented) can't force this row wider than
              the screen on a narrow viewport; unchanged whenever the
              viewport is wide enough to fit it anyway. */}
          <div className="sidebar" style={{ width: `min(${sidebarWidth}px, 100%)`, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", height: "100%" }}>
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
            <div className="card card-priority" style={{ marginTop: 10, flexGrow: 1 }}>
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
          </div>

          {/* Docked chat panel (desktop, map view) */}
          {dockChat && openConvPaxId && (
            <div style={{ width: "min(320px, 100%)", flexShrink: 0, overflow: "hidden", height: "100%", minHeight: 0, padding: 10 }}>
              <SectionErrorBoundary label="对话面板">
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
              </SectionErrorBoundary>
            </div>
          )}
        </div>
      </div>

      {/* Mobile / narrow: floating chat overlay */}
      {openConvPaxId && !dockChat && (
        <SectionErrorBoundary label="对话面板">
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
        </SectionErrorBoundary>
      )}

      <ToastHost items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
