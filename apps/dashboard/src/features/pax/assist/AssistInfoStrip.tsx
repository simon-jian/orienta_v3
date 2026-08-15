import type { AssistInfoStrip as Strip } from "./assistTypes";

export function AssistInfoStrip({ strip }: { strip: Strip }) {
  return (
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
        <div className="pax-assist-gate">{strip.gate}</div>
      </div>
      <div className="pax-assist-info-item">
        <div className="pax-assist-info-label">Status</div>
        <div className="pax-assist-info-val">{strip.status}</div>
      </div>
    </div>
  );
}
