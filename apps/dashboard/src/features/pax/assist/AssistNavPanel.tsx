import type { Ref } from "react";
import { AssistNavPlanPanel } from "./AssistNavPlanPanel";
import type { NavPlanConfirmed, NavPlanHints } from "./navPlan";

type Props = {
  plan: NavPlanConfirmed | null;
  hints: NavPlanHints;
  onConfirmPlan: (plan: NavPlanConfirmed) => void;
  onChangePlan: () => void;
  mapSrc: string;
  mapFrameRef: Ref<HTMLIFrameElement>;
  navDebug: string;
  pdrStatus: string;
  pdrActive: boolean;
  pdrBackendOk: boolean | null;
  pdrHasRoute: boolean;
  routePlanning: boolean;
  canShareLocation: boolean;
  onTogglePdr: () => void;
};

export function AssistNavPanel({
  plan,
  hints,
  onConfirmPlan,
  onChangePlan,
  mapSrc,
  mapFrameRef,
  navDebug,
  pdrStatus,
  pdrActive,
  pdrBackendOk,
  pdrHasRoute,
  routePlanning,
  canShareLocation,
  onTogglePdr,
}: Props) {
  if (!plan) {
    return <AssistNavPlanPanel hints={hints} onConfirm={onConfirmPlan} />;
  }

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
          {routePlanning ? "正在向室内地图请求路线…" : null}
          {!routePlanning && navDebug ? navDebug : null}
          {pdrStatus ? ` · ${pdrStatus}` : ""}
        </div>
      </div>
      <div className="pax-assist-nav-frame">
        <iframe
          ref={mapFrameRef}
          title="Passenger indoor navigation"
          src={mapSrc}
          allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write"
        />
      </div>
      <div className="pax-assist-status-row">
        <button
          type="button"
          className="pax-assist-loc-btn"
          onClick={onTogglePdr}
          disabled={!canShareLocation || (!pdrActive && (!pdrHasRoute || routePlanning))}
        >
          {pdrActive ? "停止导航 (PDR)" : "开始步行导航 (PDR)"}
        </button>
        {pdrBackendOk === false ? <span>PDR offline</span> : null}
        {pdrHasRoute && !pdrActive ? <span>路线已显示 · 可启动 IMU</span> : null}
      </div>
    </section>
  );
}
