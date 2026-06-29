/**
 * Dashboard FIDS board (departures / arrivals).
 *
 * Production sources this from a live FIDS feed. No demo/seed board is bundled;
 * until a live board endpoint is wired both lists are empty.
 */
export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

export const REFRESH_MS = 60 * 60 * 1000; // 1 hour

export async function fetchDepartures(_airport?: string): Promise<FidsFlight[]> {
  return [];
}

export async function fetchArrivals(_airport?: string): Promise<FidsFlight[]> {
  return [];
}
