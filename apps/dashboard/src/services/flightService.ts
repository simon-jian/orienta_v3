import type { Flight } from "../types/types";

/**
 * Dashboard flight list.
 *
 * Production sources this from a live FIDS feed. No demo/seed flights are bundled;
 * until a live board endpoint is wired this returns an empty list.
 */
export function buildFlights(_airportId?: string): Flight[] {
  return [];
}
