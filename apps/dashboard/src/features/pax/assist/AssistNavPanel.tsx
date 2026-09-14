import type { MutableRefObject } from "react";
import type { PaxSession } from "../session";
import { usePaxT } from "../i18n";
import { AssistNavPlanPanel } from "./AssistNavPlanPanel";
import type { NavPlanConfirmed, NavPlanHints } from "./navPlan";

type Props = {
  session: PaxSession;
  plan: NavPlanConfirmed | null;
  hints: NavPlanHints;
  /** Owned by usePdrTelemetryRelay, which validates messages against this frame. */
  frameRef: MutableRefObject<HTMLIFrameElement | null>;
  /** Last position-sync state, so a degraded upload is visible while walking. */
  telemetryStatus: string;
  onConfirmPlan: (plan: NavPlanConfirmed) => void;
  onChangePlan: () => void;
  pdrBackendOk: boolean | null;
  onRetryPdr?: () => void;
};

/**
 * pedestrian_dead_reckoning's own navigation page (pdr.html), same-origin via
 * /pdr-ui. `ui=minimal` trims it to the map plus Start/Stop; `sessionToken`
 * lets its orienta bridge authenticate the deactivate call on stop, while live
 * positions come to us by postMessage and go out over our WebSocket.
 */
function buildPdrUiSrc(session: PaxSession, plan: NavPlanConfirmed): string {
  const u = new URL("/pdr-ui/pdr.html", window.location.origin);
  u.searchParams.set("airport", plan.airport);
  u.searchParams.set("from", plan.fromPoiId);
  u.searchParams.set("to", plan.toPoiId);
  if (plan.airport === "PEK") u.searchParams.set("floor", "L2");
  u.searchParams.set("ui", "minimal");
  u.searchParams.set("orientaBackend", window.location.origin);
  u.searchParams.set("tenantId", session.passenger.tenantId);
  u.searchParams.set("passengerId", session.passenger.id);
  u.searchParams.set("sessionToken", session.token);
  return u.toString();
}

export function AssistNavPanel({
  session,
  plan,
  hints,
  frameRef,
  telemetryStatus,
  onConfirmPlan,
  onChangePlan,
  pdrBackendOk,
  onRetryPdr,
}: Props) {
  const t = usePaxT();

  if (!plan) {
    return <AssistNavPlanPanel hints={hints} onConfirm={onConfirmPlan} />;
  }

  if (pdrBackendOk === false) {
    return (
      <section className="pax-assist-nav-panel">
        <div className="pax-assist-nav-hint">
          {t("nav.pdrMissing")}
          {onRetryPdr ? (
            <button type="button" className="pax-assist-nav-replan" onClick={onRetryPdr} style={{ marginLeft: 8 }}>
              {t("nav.retry")}
            </button>
          ) : null}
          <button type="button" className="pax-assist-nav-replan" onClick={onChangePlan} style={{ marginLeft: 8 }}>
            {t("nav.replan")}
          </button>
        </div>
      </section>
    );
  }

  const src = buildPdrUiSrc(session, plan);

  return (
    <section className="pax-assist-nav-panel">
      <div className="pax-assist-nav-hint">
        <div className="pax-assist-nav-route">
          <strong>
            {plan.airport}: {plan.fromLabel} → {plan.toLabel}
          </strong>
          <button type="button" className="pax-assist-nav-replan" onClick={onChangePlan}>
            {t("nav.replan")}
          </button>
        </div>
        <div>{t("nav.pdrHint")}</div>
        {telemetryStatus ? <div className="pax-assist-nav-telemetry">{telemetryStatus}</div> : null}
      </div>
      <div className="pax-assist-nav-frame pax-assist-nav-frame--pdr">
        <iframe
          ref={frameRef}
          title={t("nav.iframeTitle")}
          src={src}
          allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write; geolocation"
        />
      </div>
    </section>
  );
}
