/**
 * Tenant registry — maps an operator tenant to its airport (Multi-airport Phase 0).
 *
 * The session JWT carries `tenantId` today; `airportForTenant()` is the single
 * place that resolves which hub a tenant operates. Adding a tenant on a new hub
 * is one `registerTenant()` call.
 */
import { DEFAULT_AIRPORT_ID } from "../airports/registry";
import type { AirportId } from "../airports/types";

export type TenantDefinition = {
  id: string;
  airportId: AirportId;
  displayName: string;
  /** Optional per-tenant feature flags (reserved for later phases). */
  features?: Record<string, boolean>;
};

const tenants = new Map<string, TenantDefinition>();

export function registerTenant(def: TenantDefinition): void {
  tenants.set(def.id.trim().toLowerCase(), def);
}

registerTenant({ id: "airchina", airportId: "PEK", displayName: "Air China" });

/** Fallback tenant (mirrors server `ROUTE_SITE_DEFAULT_TENANT`). */
export const DEFAULT_TENANT_ID = "airchina";

export function getTenant(id?: string | null): TenantDefinition | undefined {
  if (!id) return undefined;
  return tenants.get(id.trim().toLowerCase());
}

/** Resolve the airport a tenant operates, falling back to the default hub. */
export function airportForTenant(tenantId?: string | null): AirportId {
  return getTenant(tenantId)?.airportId ?? DEFAULT_AIRPORT_ID;
}

export function listTenants(): TenantDefinition[] {
  return [...tenants.values()];
}
