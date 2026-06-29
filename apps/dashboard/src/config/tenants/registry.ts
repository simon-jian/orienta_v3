/**
 * Tenant registry — maps an operator tenant (airline) to its airport.
 *
 * Hydrated at runtime from data config alongside airports (server: YAML;
 * browser: bootstrap API). The session JWT carries `tenantId`;
 * `airportForTenant()` is the single place that resolves which hub a tenant
 * operates. Adding an airline is one tenant config file, not a code change.
 */
import { defaultAirportId } from "../airports/registry";
import type { AirportId } from "../airports/types";

export type TenantDefinition = {
  id: string;
  airportId: AirportId;
  displayName: string;
  /** Optional per-tenant feature flags (reserved for later phases). */
  features?: Record<string, boolean>;
};

const tenants = new Map<string, TenantDefinition>();
let defaultTenant = "airchina";

export function registerTenant(def: TenantDefinition): void {
  tenants.set(def.id.trim().toLowerCase(), def);
}

/** Replace all registered tenants (server startup / client bootstrap). */
export function setTenants(defs: TenantDefinition[], opts?: { defaultId?: string }): void {
  tenants.clear();
  for (const d of defs) registerTenant(d);
  if (opts?.defaultId) defaultTenant = opts.defaultId.trim().toLowerCase();
  else if (defs[0]) defaultTenant = defs[0].id.trim().toLowerCase();
}

export function setDefaultTenantId(id: string): void {
  if (id && id.trim()) defaultTenant = id.trim().toLowerCase();
}

/** Current default tenant id (set during hydration; mirrors ROUTE_SITE_DEFAULT_TENANT). */
export function defaultTenantId(): string {
  return defaultTenant;
}

export function getTenant(id?: string | null): TenantDefinition | undefined {
  if (!id) return undefined;
  return tenants.get(id.trim().toLowerCase());
}

/** Resolve the airport a tenant operates, falling back to the default hub. */
export function airportForTenant(tenantId?: string | null): AirportId {
  return getTenant(tenantId)?.airportId ?? defaultAirportId();
}

export function listTenants(): TenantDefinition[] {
  return [...tenants.values()];
}
