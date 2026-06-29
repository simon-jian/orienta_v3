import { useMemo, useState } from "react";
import type { Gate, Flight, PassengerComputed, PaxExtStatus } from "../../types/types";
import { statusBadge, extStatusLabel } from "../../utils/statusDisplay";
import { clientDefaultAirport } from "../../config/client";

export default function DashboardTab({
  passengers, presence, riskCounts, priorityList,
  onSelectPax, onSendSms, onRequestLocation, onOpenConversation,
  gatesById, flightsById,
}: {
  passengers: PassengerComputed[];
  presence: Record<string, boolean>;
  riskCounts: Record<string, number>;
  priorityList: PassengerComputed[];
  onSelectPax(id: string): void;
  onSendSms(pid: string, msg: string): void;
  onRequestLocation(pid: string): void;
  onOpenConversation(pid: string): void;
  gatesById: Map<string, Gate>;
  flightsById: Map<string, Flight>;
}) {
  const [filter, setFilter] = useState<string>("all");

  const displayed = useMemo(() => {
    if (filter === "all") return passengers;
    if (filter === "lost") return passengers.filter(p => p.extStatus === "lost");
    if (filter === "urgent") return passengers.filter(p => p.transfer?.urgency === "urgent" || p.extStatus === "red");
    if (filter === "missed") return passengers.filter(p => p.extStatus === "missed");
    if (filter === "offline") return passengers.filter(p => p.extStatus === "offline");
    if (filter === "premium") return passengers.filter(p => p.plan === "premium");
    return passengers;
  }, [passengers, filter]);

  const extStatusOrder: Record<string, number> = { lost: 0, red: 1, yellow: 2, missed: 3, offline: 4, green: 5, gray: 6 };
  const sorted = [...displayed].sort((a, b) => (extStatusOrder[a.extStatus] ?? 9) - (extStatusOrder[b.extStatus] ?? 9));

  const __ap = clientDefaultAirport();
  const airportTitle = `Transfer Control Dashboard — ${__ap.iata} ${__ap.defaultTerminal} · International → International`;

  const badgeItems = [
    { key: "green", label: "On Track", cls: "green" },
    { key: "yellow", label: "Tight", cls: "yellow" },
    { key: "red", label: "At Risk", cls: "red" },
    { key: "lost", label: "Lost", cls: "lost" },
    { key: "offline", label: "Offline", cls: "offline" },
    { key: "missed", label: "Missed", cls: "missed" },
  ] as const;

  return (
    <div className="transfer-control-dashboard">
      {/* Header */}
      <div className="tcd-header">
        <h2>
          <span>🔁 {airportTitle}</span>
          <span className="tcd-count">{passengers.length} passengers</span>
        </h2>
        <div className="tcd-badges">
          {badgeItems.map(({ key, label, cls }) => (
            <div key={key} className={`tcd-badge ${cls}`}>
              <span className="tcd-badge-num">{(riskCounts as Record<string, number>)[key] || 0}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Requires Immediate Action */}
      {priorityList.length > 0 && (
        <div className="tcd-urgent">
          <h3>⚠️ Requires Immediate Action</h3>
          {priorityList.map(p => {
            const gate = gatesById.get(p.gateId);
            const flight = flightsById.get(p.flightId);
            const rowCls = p.extStatus === "red" ? "at-risk" : p.extStatus === "lost" ? "lost" : "missed";
            return (
              <div key={p.id} className={`tcd-urgent-row ${rowCls}`}>
                <span className="tcd-urgent-dot" style={{ background: statusBadge(p.extStatus) }} />
                <div className="tcd-urgent-info">
                  <div className="tcd-urgent-name">{p.name} <span style={{ fontWeight: 500, color: "var(--tcd-text-muted)" }}>({p.id})</span></div>
                  <div className="tcd-urgent-meta">{extStatusLabel(p.extStatus as PaxExtStatus)} · Gate {gate?.name || "?"} · {flight?.callsign || p.flightId}</div>
                  {p.transfer && <div className="tcd-urgent-route">{p.transfer.inboundFlight} {p.transfer.inboundFrom} → {p.flightId} {p.transfer.outboundTo}</div>}
                </div>
                <div className="tcd-urgent-actions">
                  <button className="tcd-action-btn" onClick={() => onOpenConversation(p.id)} title="Chat">💬</button>
                  {p.extStatus === "lost" && <button className="tcd-action-btn" onClick={() => onRequestLocation(p.id)} title="Request location">📍</button>}
                  <button className="tcd-action-btn primary" onClick={() => onSelectPax(p.id)}>View</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All Passengers */}
      <div className="tcd-all">
        <div className="tcd-all-header">
          <h3>All Passengers</h3>
          <div className="tcd-filter-group">
            {["all", "lost", "urgent", "missed", "offline", "premium"].map(f => (
              <button key={f} className={`tcd-filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
        </div>

        <div className="tcd-table-wrap">
          <table className="tcd-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>ID</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Inbound</th>
                <th>Outbound</th>
                <th>Gate</th>
                <th>ETA</th>
                <th>Online</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const gate = gatesById.get(p.gateId);
                const flight = flightsById.get(p.flightId);
                const isOnline = !!presence[p.id];
                const statusCls = (p.extStatus as string) in { green: 1, yellow: 1, red: 1, lost: 1, offline: 1, missed: 1, gray: 1 } ? p.extStatus : "gray";
                return (
                  <tr key={p.id} onClick={() => onSelectPax(p.id)}>
                    <td>
                      <span className="tcd-status-cell">
                        <span className="tcd-status-dot" style={{ background: statusBadge(p.extStatus) }} />
                        <span className={`tcd-status-label ${statusCls}`}>{extStatusLabel(p.extStatus as PaxExtStatus)}</span>
                      </span>
                    </td>
                    <td className="tcd-id-cell">{p.id}</td>
                    <td>{p.name}{p.needsWheelchair ? " ♿" : ""}{p.plan === "premium" ? " 💎" : ""}</td>
                    <td>
                      <span className={`tcd-plan-tag ${p.plan === "premium" ? "premium" : "free"}`}>
                        {p.plan === "premium" ? "Premium" : "Free"}
                      </span>
                    </td>
                    <td>
                      <div>{p.transfer.inboundFlight}</div>
                      <div style={{ fontSize: 11, color: "var(--tcd-text-muted)" }}>{p.transfer.inboundFrom}</div>
                    </td>
                    <td>
                      <div>{flight?.callsign || p.flightId}</div>
                      <div style={{ fontSize: 11, color: "var(--tcd-text-muted)" }}>{p.transfer.outboundTo}</div>
                    </td>
                    <td>{gate?.name || p.gateId}</td>
                    <td>{p.etaMinutes !== null ? `${p.etaMinutes}m` : "—"}</td>
                    <td>
                      <span className={`tcd-online-dot ${isOnline ? "on" : "off"}`} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="tcd-row-actions">
                        <button className="tcd-action-btn" onClick={() => onOpenConversation(p.id)} title="Chat">💬</button>
                        {p.extStatus === "lost" && <button className="tcd-action-btn" onClick={() => onRequestLocation(p.id)}>📍</button>}
                        {(p.extStatus === "offline" || p.extStatus === "lost") && (
                          <button className="tcd-action-btn" onClick={() => onSendSms(p.id, `Orienta: Your flight ${p.flightId} is at Gate ${gate?.name}. Please proceed immediately.`)}>📨</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
