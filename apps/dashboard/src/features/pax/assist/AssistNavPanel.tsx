import { useEffect, type MutableRefObject } from "react";
import type { PaxSession } from "../session";
import { AssistNavPlanPanel } from "./AssistNavPlanPanel";
import type { NavPlanConfirmed, NavPlanHints } from "./navPlan";

// #region agent log
function dbgNav(message: string, data: Record<string, unknown>): void {
  fetch("/api/debug-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      runId: "pre-fix", hypothesisId: "B",
      location: "src/features/pax/assist/AssistNavPanel.tsx",
      message, data, timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

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
}: Props) {
  // #region agent log
  useEffect(() => {
    dbgNav("AssistNavPanel mounted", { hasPlan: !!plan, pdrBackendOk });
    return () => dbgNav("AssistNavPanel unmounted (pdr iframe destroyed)", { hasPlan: !!plan });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debug instrumentation
  }, []);
  // #endregion

  if (!plan) {
    return <AssistNavPlanPanel hints={hints} onConfirm={onConfirmPlan} />;
  }

  if (pdrBackendOk === false) {
    return (
      <section className="pax-assist-nav-panel">
        <div className="pax-assist-nav-hint">
          PDR 后端未启动（需要 `PDR_API_ORIGIN` / :8000）。无法进入步行导航。
          <button type="button" className="pax-assist-nav-replan" onClick={onChangePlan} style={{ marginLeft: 8 }}>
            重新选路
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
            重新选路
          </button>
        </div>
        <div>
          下方为完整 Pedestrian Dead Reckoning 导航页：等路线出现后点 <b>Start</b>，授权 IMU，走动即可计步；位置会同步到后台地图。
        </div>
        {telemetryStatus ? <div className="pax-assist-nav-telemetry">{telemetryStatus}</div> : null}
      </div>
      <div className="pax-assist-nav-frame pax-assist-nav-frame--pdr">
        <iframe
          ref={frameRef}
          title="Pedestrian dead reckoning navigation"
          src={src}
          allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write; geolocation"
        />
      </div>
    </section>
  );
}
