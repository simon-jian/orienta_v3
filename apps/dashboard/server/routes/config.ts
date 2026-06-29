/**
 * Public tenant/airport config API (Multi-airport Phase 5).
 *
 * `GET /api/config/tenant/:tenantId` lets clients (pax pages, route_site, future
 * SPAs) resolve which hub a tenant operates and its UI defaults without baking
 * PEK/airchina assumptions into the frontend. Demo/seed data (flights, premium
 * ids) is intentionally NOT exposed here.
 */
import type { Router, Request, Response } from "express";
import {
  getAirportOrDefault,
  defaultAirportId,
  listAirports,
} from "../../src/config/airports/registry";
import {
  getTenant,
  airportForTenant,
  defaultTenantId,
  listTenants,
} from "../../src/config/tenants/registry";
import { serializeAirport } from "../../src/config/airports/schema";
import type { AirportDefinition } from "../../src/config/airports/types";

/** Sanitized, client-safe view of an airport definition (no demo/seed data). */
function publicAirport(def: AirportDefinition) {
  return {
    id: def.id,
    iata: def.iata,
    icao: def.icao,
    name: def.name,
    defaultTerminal: def.defaultTerminal,
    poi: {
      mode: def.poi.mode,
      terminalQuery: def.poi.terminalQuery,
      defaultCenter: def.poi.defaultCenter,
      bbox: def.poi.bbox,
    },
    map: { indoorMapEnabled: def.map.indoorMapEnabled },
    routeSite: def.routeSite,
  };
}

export function registerConfigRoutes(router: Router): void {
  router.get("/tenant/:tenantId", (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = getTenant(tenantId);
    const airportId = airportForTenant(tenantId);
    const airport = getAirportOrDefault(airportId);

    res.json({
      ok: true,
      tenant: {
        id: tenant?.id ?? tenantId,
        displayName: tenant?.displayName ?? tenantId,
        airportId,
        known: !!tenant,
      },
      airport: publicAirport(airport),
      terminals: airport.terminals,
      defaults: {
        airport: defaultAirportId(),
        tenant: defaultTenantId(),
        terminal: airport.defaultTerminal,
      },
    });
  });

  // Full runtime config for client hydration (Multi-airport Model B). Returns
  // every registered airport + tenant in serializable form so the browser can
  // rebuild the registry without bundling any hub config.
  router.get("/bootstrap", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      airports: listAirports().map(serializeAirport),
      tenants: listTenants(),
      defaults: {
        airport: defaultAirportId(),
        tenant: defaultTenantId(),
      },
    });
  });
}
