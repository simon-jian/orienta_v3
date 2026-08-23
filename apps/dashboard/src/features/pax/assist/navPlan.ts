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

/**
 * Which end of the walk a known gate belongs to.
 *
 * The flight page hands the map the same gate as both ends, because the map
 * only needs a point to centre on. Passing that pair straight to the route
 * planner prefilled 起点 with the gate the passenger is walking *toward* and
 * left 终点 empty — and an identical pair can never be confirmed anyway, since
 * start and end must differ. A departure gate is a destination; an arrival gate
 * is where the walk starts.
 */
export function gateHintsForLeg(
  fromGate: string | undefined,
  toGate: string | undefined,
  leg: "dep" | "arr",
): { fromGateHint?: string; toGateHint?: string } {
  // A real two-ended route (a transfer) already says which end is which.
  if (fromGate && toGate && fromGate !== toGate) {
    return { fromGateHint: fromGate, toGateHint: toGate };
  }
  const gate = toGate || fromGate;
  if (!gate) return {};
  return leg === "arr" ? { fromGateHint: gate } : { toGateHint: gate };
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
