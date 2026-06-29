/**
 * Client-side airport/tenant resolution.
 *
 * The registry is hydrated at app boot from `/api/config/bootstrap` (see
 * `bootstrap.ts`), so these resolve the runtime-loaded config. A Vite env can
 * still pin a specific default for a given build:
 *
 *   VITE_DEFAULT_AIRPORT   e.g. "PEK"
 *   VITE_ORIENTA_TENANT    e.g. "airchina"
 */
import { defaultAirportId, getAirportOrDefault } from "./airports/registry";
import { defaultTenantId } from "./tenants/registry";

function envStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Default airport id for this client (env override → hydrated default hub). */
export function clientDefaultAirportId(): string {
  return envStr(import.meta.env.VITE_DEFAULT_AIRPORT) ?? defaultAirportId();
}

/** Default tenant id for this client (env override → hydrated default tenant). */
export function clientDefaultTenantId(): string {
  return envStr(import.meta.env.VITE_ORIENTA_TENANT) ?? defaultTenantId();
}

/** Resolved default airport definition for this client. */
export function clientDefaultAirport() {
  return getAirportOrDefault(clientDefaultAirportId());
}
