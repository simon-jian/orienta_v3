/**
 * PEK T3E airport data — geographic constants, static flight list, demo config.
 * No sim-engine imports; safe to use from both frontend and server.
 */
import type { PaxPlan } from "../../types/types";

// ─── Flights ──────────────────────────────────────────────────────────────────

const PEK_INBOUND_FLIGHTS = [
  { id: "CA836",  from: "LHR", fromCity: "London",        arr: -85 },
  { id: "CA856",  from: "FRA", fromCity: "Frankfurt",     arr: -70 },
  { id: "CA901",  from: "NRT", fromCity: "Tokyo",         arr: -60 },
  { id: "CA902",  from: "ICN", fromCity: "Seoul",         arr: -55 },
  { id: "CA921",  from: "SYD", fromCity: "Sydney",        arr: -90 },
  { id: "CA931",  from: "LAX", fromCity: "Los Angeles",   arr: -95 },
  { id: "CA841",  from: "CDG", fromCity: "Paris",         arr: -75 },
  { id: "CA861",  from: "AMS", fromCity: "Amsterdam",     arr: -65 },
  { id: "CA7206", from: "SFO", fromCity: "San Francisco", arr: -80 },
] as const;

export const PEK_OUTBOUND_FLIGHTS = [
  { id: "CA783",  to: "FRA", toCity: "Frankfurt",     gate: "E15", depOffset: 55,  status: "Gate Open"  as const },
  { id: "CA837",  to: "LHR", toCity: "London",        gate: "E19", depOffset: 40,  status: "Boarding"   as const },
  { id: "CA781",  to: "CDG", toCity: "Paris",         gate: "E22", depOffset: 25,  status: "Final Call" as const },
  { id: "CA831",  to: "AMS", toCity: "Amsterdam",     gate: "E26", depOffset: 70,  status: "Gate Open"  as const },
  { id: "CA903",  to: "NRT", toCity: "Tokyo",         gate: "E12", depOffset: 50,  status: "Boarding"   as const },
  { id: "CA935",  to: "LAX", toCity: "Los Angeles",   gate: "E08", depOffset: 90,  status: "Gate Open"  as const },
  { id: "CA911",  to: "SYD", toCity: "Sydney",        gate: "E05", depOffset: 35,  status: "Boarding"   as const },
  { id: "CA921",  to: "ICN", toCity: "Seoul",         gate: "E30", depOffset: 45,  status: "Boarding"   as const },
  { id: "CA741",  to: "MNL", toCity: "Manila",        gate: "E33", depOffset: -20, status: "Closed"     as const },
  { id: "CA861",  to: "SIN", toCity: "Singapore",     gate: "E36", depOffset: -15, status: "Closed"     as const },
  { id: "CA5281", to: "SIN", toCity: "Singapore",     gate: "E25", depOffset: 30,  status: "Boarding"   as const },
] as const;

/** Flight id (and spaced variant) → departure gate for nav_request / transfer hints. */
export const PEK_FLIGHT_GATE_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const f of PEK_OUTBOUND_FLIGHTS) {
    map[f.id] = f.gate;
    const spaced = f.id.replace(/^([A-Z]{2})(\d+)$/, "$1 $2");
    if (spaced !== f.id) map[spaced] = f.gate;
  }
  // Inbound-only demo flights (arrival leg gate hints)
  const inboundGates: Record<string, string> = {
    CA836: "E16", CA856: "E17", CA901: "E18", CA902: "E17", CA921: "E19",
    CA931: "E20", CA841: "E16", CA861: "E17", CA7206: "E32",
  };
  for (const [id, gate] of Object.entries(inboundGates)) {
    map[id] = gate;
    map[id.replace(/^([A-Z]{2})(\d+)$/, "$1 $2")] = gate;
  }
  return map;
})();

// ─── Premium IDs ──────────────────────────────────────────────────────────────

export const PEK_PREMIUM_IDS = new Set([
  "TX1", "TX2", "TX3", "P3", "P7", "P8", "P11", "P15", "P21", "P27",
]);

// ─── Demo config (PaxEntryWrapper) ────────────────────────────────────────────

export type PaxDemoConfig = {
  displayName?: string;
  plan?: PaxPlan;
  transferGates?: { gateFrom: string; gateTo: string };
  alwaysVideoDialog?: boolean;
  canVideoDialog?: boolean;
};

export const PEK_PAX_DEMO_CONFIG: Record<string, PaxDemoConfig> = {
  TX1: { transferGates: { gateFrom: "E16", gateTo: "E19" }, alwaysVideoDialog: true },
  TX2: { transferGates: { gateFrom: "E18", gateTo: "E19" }, alwaysVideoDialog: true },
  TX3: { transferGates: { gateFrom: "E17", gateTo: "E19" }, alwaysVideoDialog: true },
  P8:  { displayName: "YAN JIANG", plan: "premium", transferGates: { gateFrom: "E32", gateTo: "E25" }, canVideoDialog: true },
};

export const PEK_DEFAULT_TRANSFER_GATES = { gateFrom: "E16", gateTo: "E19" };

// ─── Demo flight lookup ───────────────────────────────────────────────────────

/** [outbound index, inbound index] into PEK_OUTBOUND_FLIGHTS / PEK_INBOUND_FLIGHTS */
const DEMO_FLIGHT_INDICES: Record<string, readonly [number, number]> = {
  TX1: [1, 0], TX2: [0, 1], TX3: [2, 1],
  P3:  [5, 2], P7:  [4, 3], P8:  [10, 8], P11: [3, 4], P15: [2, 5],
  P21: [7, 6], P27: [6, 7],
  P4:  [5, 0], P5:  [4, 1], P6:  [9, 2], P9:  [4, 4], P10: [5, 5],
  P12: [6, 6], P13: [7, 7], P14: [8, 0], P16: [3, 1], P17: [5, 2],
  P18: [2, 3], P19: [6, 4], P20: [4, 5], P22: [0, 6], P23: [7, 7],
  P24: [1, 0], P25: [3, 1], P26: [0, 2], P28: [5, 3], P29: [4, 4], P30: [9, 5],
};

export function demoFlightsForPid(pid: string): { dep?: string; arr?: string } {
  const idxs = DEMO_FLIGHT_INDICES[pid];
  if (!idxs) return {};
  return {
    dep: PEK_OUTBOUND_FLIGHTS[idxs[0]]?.id,
    arr: PEK_INBOUND_FLIGHTS[idxs[1]]?.id,
  };
}

// ─── Simulator panel (Dashboard sidebar) ─────────────────────────────────────

export const PEK_SIM_PAX = [
  { id: "TX3",  name: "Yan Jiang",     plan: "Premium", note: "At Risk" },
  { id: "TX1",  name: "Siyao Fu",      plan: "Premium", note: "Offline初始" },
  { id: "TX2",  name: "Sophie Chen",   plan: "Premium", note: "Normal · Moving" },
  { id: "P4",   name: "Raj Patel",     plan: "Free",    note: "AI agent only" },
  { id: "P13",  name: "Zara Williams", plan: "Free",    note: "AI agent only" },
] as const;
