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

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function clearStore(key: string): void {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function saveNavHints(hints: NavPlanHints): void {
  writeStore(HINTS_KEY, JSON.stringify(hints));
}

export function getNavHints(): NavPlanHints | null {
  try {
    const raw = readStore(HINTS_KEY);
    return raw ? (JSON.parse(raw) as NavPlanHints) : null;
  } catch {
    return null;
  }
}

export function saveConfirmedNavPlan(plan: NavPlanConfirmed): void {
  writeStore(PLAN_KEY, JSON.stringify(plan));
}

export function getConfirmedNavPlan(): NavPlanConfirmed | null {
  try {
    const raw = readStore(PLAN_KEY);
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
  clearStore(PLAN_KEY);
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
