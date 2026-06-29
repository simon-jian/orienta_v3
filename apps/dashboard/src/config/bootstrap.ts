/**
 * Client runtime config bootstrap (Multi-airport Model B).
 *
 * Fetches airport/tenant config from the server (`/api/config/bootstrap`) and
 * hydrates the shared registries before the app renders. The browser bundles no
 * hub config — adding an airport/airline is a server-side YAML drop + restart,
 * with no frontend rebuild.
 */
import { apiUrl } from "./api";
import { toAirportDefinition } from "./airports/schema";
import { setAirports } from "./airports/registry";
import { setTenants, type TenantDefinition } from "./tenants/registry";

type BootstrapResponse = {
  ok?: boolean;
  airports?: unknown[];
  tenants?: TenantDefinition[];
  defaults?: { airport?: string; tenant?: string };
};

export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/config/bootstrap"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`bootstrap_http_${res.status}`);
    const data = (await res.json()) as BootstrapResponse;
    const airports = (data.airports ?? []).map(toAirportDefinition);
    setAirports(airports, { defaultId: data.defaults?.airport });
    setTenants(data.tenants ?? [], { defaultId: data.defaults?.tenant });
  } catch (err) {
    // Non-fatal: the registry keeps its built-in fallback so the app still
    // renders (degraded) even if the API is unreachable at boot.
    console.error("[orienta] runtime config bootstrap failed:", err);
  }
}
