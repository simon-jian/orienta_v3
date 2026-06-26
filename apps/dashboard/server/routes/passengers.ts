/**
 * Passenger management REST API.
 *
 * Admin routes (require JWT cookie):
 *   GET    /api/passengers?tenant=airchina
 *   POST   /api/passengers?tenant=airchina
 *   PATCH  /api/passengers/:id?tenant=airchina
 *   DELETE /api/passengers/:id?tenant=airchina
 *
 * Returns passengers as WorldState-compatible Passenger objects with
 * outboundDep filled in from the live flight schedule.
 */
import type { Router, Request, Response } from "express";
import { requireAdmin } from "./auth";
import { ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type { HubStore } from "../hub/HubStore";
import { buildPekFlights } from "../../src/services/flightService";
import type { Passenger } from "../../src/types/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tenantFromQuery(req: Request): string {
  return String(req.query.tenant || ROUTE_SITE_DEFAULT_TENANT).trim();
}

/**
 * Enrich a passenger record's transfer.outboundDep from the live flight list
 * so that computePassenger() gets an accurate departure time.
 */
function enrichWithFlightTime(passengers: Passenger[]): Passenger[] {
  const flights = buildPekFlights();
  const byId = new Map(flights.map((f) => [f.id, f]));
  return passengers.map((p) => {
    const flight = byId.get(p.flightId);
    if (!flight) return p;
    return {
      ...p,
      transfer: {
        ...p.transfer,
        outboundDep: flight.scheduledDep,
        urgency: flight.status === "Final Call" || flight.status === "Boarding" ? "urgent" : "normal",
      },
    };
  });
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerPassengerRoutes(
  router: Router,
  store: HubStore,
  registry: PassengerRegistry,
): void {

  /** GET /api/passengers — list all passengers for a tenant */
  router.get("/", requireAdmin, (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    const records  = registry.list(tenantId);

    // Overlay live online state from HubStore (more up-to-date than DB)
    const onlineSet = new Set(store.listOnline(tenantId));
    const passengers: Passenger[] = records.map(
      // Strip registry-only fields that the Passenger type doesn't have.
      ({ tenantId: _tid, source: _src, createdAt: _ca, lastSeenAt: _ls, isOnline: _io, ...rest }) => rest,
    );

    res.json({
      ok: true,
      tenantId,
      passengers: enrichWithFlightTime(passengers),
      online: Array.from(onlineSet),
    });
  });

  /** POST /api/passengers — pre-register a passenger (admin) */
  router.post("/", requireAdmin, (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    const body     = req.body || {};

    const id      = String(body.id || "").trim();
    const flightId = String(body.flightId || body.flight_id || "").trim();
    const gateId   = String(body.gateId   || body.gate_id   || "").trim();

    if (!id)       return res.status(400).json({ ok: false, error: "missing_id" });
    if (!flightId) return res.status(400).json({ ok: false, error: "missing_flightId" });
    if (!gateId)   return res.status(400).json({ ok: false, error: "missing_gateId" });

    const record = registry.getOrCreate({
      id, tenantId,
      name:             String(body.name     || "").trim()  || undefined,
      nationality:      String(body.nationality || "").trim() || undefined,
      locale:           String(body.locale   || "").trim()  || undefined,
      needsWheelchair:  !!body.needsWheelchair,
      plan:             body.plan === "premium" ? "premium" : "free",
      flightId, gateId,
      inboundFlightId:  String(body.inboundFlightId || body.arr || "").trim() || undefined,
      inboundFrom:      String(body.inboundFrom     || "").trim() || undefined,
      outboundTo:       String(body.outboundTo      || "").trim() || undefined,
      source: "manual",
    });

    return res.status(201).json({ ok: true, passenger: record });
  });

  /** PATCH /api/passengers/:id — update extStatus, activity, plan, etc. */
  router.patch("/:id", requireAdmin, (req: Request, res: Response) => {
    const tenantId    = tenantFromQuery(req);
    const passengerId = req.params.id;
    const body        = req.body || {};

    const allowed = ["name", "nationality", "locale", "needsWheelchair", "plan",
                     "flightId", "gateId", "extStatus", "activity"] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    const updated = registry.update(tenantId, passengerId, patch);
    if (!updated) return res.status(404).json({ ok: false, error: "passenger_not_found" });

    return res.json({ ok: true, passenger: updated });
  });

  /** DELETE /api/passengers/:id */
  router.delete("/:id", requireAdmin, (req: Request, res: Response) => {
    const tenantId    = tenantFromQuery(req);
    const passengerId = req.params.id;
    const deleted = registry.delete(tenantId, passengerId);
    if (!deleted) return res.status(404).json({ ok: false, error: "passenger_not_found" });
    return res.json({ ok: true });
  });
}
