/**
 * Client-side airport/tenant resolution (Multi-airport Phase 0).
 *
 * Single source for "which hub/tenant is this build defaulting to", driven by
 * Vite env with the current hardcoded values as fallback so behaviour is
 * unchanged until consumers (Dashboard, MapView, pax pages) are wired in
 * Phase 1+.
 *
 *   VITE_DEFAULT_AIRPORT   e.g. "PEK"
 *   VITE_ORIENTA_TENANT    e.g. "airchina"
 */
import { DEFAULT_AIRPORT_ID, getAirportOrDefault } from "./airports/registry";
import { DEFAULT_TENANT_ID } from "./tenants/registry";

function envStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Default airport id for this build (env override → PEK). */
export const CLIENT_DEFAULT_AIRPORT: string =
  envStr(import.meta.env.VITE_DEFAULT_AIRPORT) ?? DEFAULT_AIRPORT_ID;

/** Default tenant id for this build (env override → airchina). */
export const CLIENT_DEFAULT_TENANT: string =
  envStr(import.meta.env.VITE_ORIENTA_TENANT) ?? DEFAULT_TENANT_ID;

/** Resolved default airport definition for this build. */
export function clientDefaultAirport() {
  return getAirportOrDefault(CLIENT_DEFAULT_AIRPORT);
}
