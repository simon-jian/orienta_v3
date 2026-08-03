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

/** Give up and fall back rather than leave the app on a blank screen forever. */
const BOOTSTRAP_TIMEOUT_MS = 8000;

/**
 * @returns true if the live config loaded, false if it fell back to the
 *   registry's built-in defaults (network error, non-2xx, or timeout). The
 *   caller uses this to show a "running in degraded mode" banner — main.tsx
 *   renders the app either way so a slow/unreachable backend never produces
 *   a permanent blank screen.
 */
export async function loadRuntimeConfig(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/api/config/bootstrap"), {
      credentials: "same-origin",
      signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`bootstrap_http_${res.status}`);
    const data = (await res.json()) as BootstrapResponse;
    const airports = (data.airports ?? []).map(toAirportDefinition);
    if (airports.length === 0) throw new Error("bootstrap_no_airports");
    setAirports(airports, { defaultId: data.defaults?.airport });
    setTenants(data.tenants ?? [], { defaultId: data.defaults?.tenant });
    return true;
  } catch (err) {
    // Non-fatal: the registry keeps its built-in fallback so the app still
    // renders (degraded) even if the API is unreachable at boot.
    console.error("[orienta] runtime config bootstrap failed:", err);
    return false;
  }
}
