/**
 * Dashboard FIDS board (departures / arrivals).
 *
 * Production sources this from a live FIDS feed. No demo/seed board is bundled;
 * until a live board endpoint is wired, every call reports status "unconfigured"
 * with an empty list, and the UI (FidsPanel) renders that distinctly from "we
 * asked and there are genuinely zero flights right now" — see FidsResult.
 */
export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

export type FidsStatus = "unconfigured" | "ok";

export type FidsResult = {
  status: FidsStatus;
  flights: FidsFlight[];
};

export const REFRESH_MS = 60 * 60 * 1000; // 1 hour

const UNCONFIGURED: FidsResult = { status: "unconfigured", flights: [] };

export async function fetchDepartures(_airport?: string): Promise<FidsResult> {
  return UNCONFIGURED;
}

export async function fetchArrivals(_airport?: string): Promise<FidsResult> {
  return UNCONFIGURED;
}
