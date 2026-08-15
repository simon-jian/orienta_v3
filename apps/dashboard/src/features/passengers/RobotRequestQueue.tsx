import type { RobotRequest } from "../pax/assist/assistTypes";
import { ROBOT_SERVICES, robotStatusLabel } from "../pax/assist/assistTypes";

export type AdminRobotRequest = RobotRequest & { passengerId: string };

type Props = {
  requests: AdminRobotRequest[];
  onOpen: (passengerId: string) => void;
  onAdvance: (passengerId: string) => void;
  onCancel: (passengerId: string) => void;
};

function serviceTitle(serviceType: string): string {
  return ROBOT_SERVICES.find((s) => s.id === serviceType)?.title || serviceType;
}

export function RobotRequestQueue({ requests, onOpen, onAdvance, onCancel }: Props) {
  if (!requests.length) {
    return (
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Robot bookings</div>
        <div className="small" style={{ opacity: 0.65 }}>No active robot requests.</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>Robot bookings ({requests.length})</div>
      {requests.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 10,
            padding: 10,
            display: "grid",
            gap: 6,
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b>{r.passengerId}</b>
            <span className="small" style={{ fontWeight: 700, color: "#c8102e" }}>
              {robotStatusLabel(r.status)}
            </span>
          </div>
          <div className="small">
            {serviceTitle(r.serviceType)} · {r.partySize} pax
          </div>
          <div className="small" style={{ opacity: 0.75 }}>
            {r.origin} → {r.destination}
          </div>
          {r.note ? <div className="small">{r.note}</div> : null}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => onOpen(r.passengerId)}>
              Open chat
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={r.status === "serving"}
              onClick={() => onAdvance(r.passengerId)}
            >
              Advance
            </button>
            <button type="button" className="btn" onClick={() => onCancel(r.passengerId)}>
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
