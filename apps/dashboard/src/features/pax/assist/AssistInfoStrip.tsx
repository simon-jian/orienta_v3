import { usePaxT } from "../i18n";
import type { AssistInfoStrip as Strip } from "./assistTypes";

export function AssistInfoStrip({ strip }: { strip: Strip }) {
  const t = usePaxT();
  return (
    <div className="pax-assist-info-strip">
      <div className="pax-assist-info-item">
        <div className="pax-assist-info-label">{t("strip.inbound")}</div>
        <div className="pax-assist-info-val">{strip.inbound}</div>
      </div>
      <div className="pax-assist-info-item">
        <div className="pax-assist-info-label">{t("strip.outbound")}</div>
        <div className="pax-assist-info-val">{strip.outbound}</div>
      </div>
      <div className="pax-assist-info-item">
        <div className="pax-assist-info-label">{t("strip.gate")}</div>
        <div className="pax-assist-gate">{strip.gate}</div>
      </div>
      <div className="pax-assist-info-item">
        <div className="pax-assist-info-label">{t("strip.status")}</div>
        <div className="pax-assist-info-val">{strip.status}</div>
      </div>
    </div>
  );
}
