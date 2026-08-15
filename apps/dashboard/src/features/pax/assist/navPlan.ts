import { findNavAirport } from "./navAirports";

const HINTS_KEY = "orienta_pax_nav_hints";
const PLAN_KEY = "orienta_pax_nav_plan";

/** Flight-derived suggestions before the user confirms POIs. */
export type NavPlanHints = {
  airport?: string;
  fromGateHint?: string;
  toGateHint?: string;
  flightId?: string;
};

/** Confirmed selection — same handoff as PDR index.html → pdr.html. */
export type NavPlanConfirmed = {
  airport: string;
  fromPoiId: string;
  toPoiId: string;
  fromLabel: string;
  toLabel: string;
  terminals: string[];
  confirmedAt: number;
};

export function saveNavHints(hints: NavPlanHints): void {
  try {
    sessionStorage.setItem(HINTS_KEY, JSON.stringify(hints));
  } catch {
    /* ignore */
  }
}

export function getNavHints(): NavPlanHints | null {
  try {
    const raw = sessionStorage.getItem(HINTS_KEY);
    return raw ? (JSON.parse(raw) as NavPlanHints) : null;
  } catch {
    return null;
  }
}

export function saveConfirmedNavPlan(plan: NavPlanConfirmed): void {
  try {
    sessionStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

export function getConfirmedNavPlan(): NavPlanConfirmed | null {
  try {
    const raw = sessionStorage.getItem(PLAN_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as NavPlanConfirmed;
    if (!plan?.airport || !plan.fromPoiId || !plan.toPoiId) return null;
    if (!findNavAirport(plan.airport)) return null;
    return plan;
  } catch {
    return null;
  }
}

export function clearConfirmedNavPlan(): void {
  try {
    sessionStorage.removeItem(PLAN_KEY);
  } catch {
    /* ignore */
  }
}

/** Flight page → assist nav tab query (no side effects). */
export function buildStartNavHref(hints: NavPlanHints): string {
  const q = new URLSearchParams({ tab: "nav", plan: "1" });
  if (hints.airport) q.set("airport", hints.airport);
  if (hints.fromGateHint) q.set("from", hints.fromGateHint);
  if (hints.toGateHint) q.set("to", hints.toGateHint);
  return `/pax/app?${q.toString()}`;
}

/** Persist flight hints and clear any prior confirmed route before leaving flight page. */
export function prepareStartNavigation(hints: NavPlanHints): string {
  saveNavHints(hints);
  clearConfirmedNavPlan();
  return buildStartNavHref(hints);
}
