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
  DEFAULT_AIRPORT_ID,
} from "../../src/config/airports/registry";
import {
  getTenant,
  airportForTenant,
  DEFAULT_TENANT_ID,
} from "../../src/config/tenants/registry";
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
        airport: DEFAULT_AIRPORT_ID,
        tenant: DEFAULT_TENANT_ID,
        terminal: airport.defaultTerminal,
      },
    });
  });
}
