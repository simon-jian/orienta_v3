/**
 * Passenger management REST API.
 *
 * Admin routes (require JWT cookie):
 *   GET    /api/passengers?tenant=airchina
 *   POST   /api/passengers?tenant=airchina
 *   PATCH  /api/passengers/:id?tenant=airchina
 *   GET    /api/passengers/:id/export?tenant=airchina  (data subject access request bundle)
 *   DELETE /api/passengers/:id?tenant=airchina          (cascading erasure)
 *
 * Returns passengers as WorldState-compatible Passenger objects with
 * outboundDep filled in from the live flight schedule.
 */
import type { Router, Request, Response } from "express";
import { requireAdmin, requireRole, requireTenantAccess, adminEmailFromRequest } from "./auth";
import { revokePaxSessionsForPassenger } from "../auth/paxSessionRevocation";
import { ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import { HubStore } from "../hub/HubStore";
import type { AuditLog } from "../lib/auditLog";
import type { PushSubscriptionStore } from "../passengers/PushSubscriptionStore";
import { buildFlights } from "../../src/services/flightService";
import { airportForTenant } from "../../src/config/tenants/registry";
import type { Passenger, PaxPlan, PaxExtStatus, PassengerActivity } from "../../src/types/types";
import { canonicalTenantId, canonicalFlightId, canonicalGateId } from "../lib/canonicalize";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tenantFromQuery(req: Request): string {
  return canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
}

// Runtime mirrors of the PaxPlan/PaxExtStatus/PassengerActivity union types —
// PATCH previously copied these fields into the DB with only a `!== undefined`
// check, so any string (not just a real enum member) would be persisted and
// later trusted by every consumer that expects one of these fixed sets.
const VALID_PLANS = new Set<PaxPlan>(["premium", "free"]);
const VALID_EXT_STATUSES = new Set<PaxExtStatus>(["green", "yellow", "red", "missed", "offline", "lost", "gray"]);
const VALID_ACTIVITIES = new Set<PassengerActivity>([
  "moving", "shopping", "dining", "idle", "at_gate", "boarded", "lounge",
]);

/**
 * Enrich a passenger record's transfer.outboundDep from the live flight list
 * so that computePassenger() gets an accurate departure time.
 */
function enrichWithFlightTime(passengers: Passenger[], tenantId: string): Passenger[] {
  const flights = buildFlights(airportForTenant(tenantId));
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
  auditLog?: AuditLog,
  pushSubs?: PushSubscriptionStore,
): void {

  /** GET /api/passengers — list all passengers for a tenant */
  router.get("/", requireAdmin, async (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const records  = await registry.list(tenantId);

    // Overlay live online state from HubStore (cluster-wide when Redis is enabled)
    const onlineSet = new Set(await store.listOnlineGlobal(tenantId));
    const passengers: Passenger[] = records.map(
      // Strip registry-only fields that the Passenger type doesn't have.
      ({ tenantId: _tid, source: _src, createdAt: _ca, lastSeenAt: _ls, isOnline: _io, ...rest }) => rest,
    );

    res.json({
      ok: true,
      tenantId,
      passengers: enrichWithFlightTime(passengers, tenantId),
      online: Array.from(onlineSet),
    });
  });

  /** POST /api/passengers — pre-register a passenger (admin/ops; not viewer) */
  router.post("/", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const body     = req.body || {};

    const id      = String(body.id || "").trim();
    const flightId = canonicalFlightId(body.flightId || body.flight_id);
    const gateId   = canonicalGateId(body.gateId || body.gate_id);

    if (!id)       return res.status(400).json({ ok: false, error: "missing_id" });
    if (!flightId) return res.status(400).json({ ok: false, error: "missing_flightId" });
    if (!gateId)   return res.status(400).json({ ok: false, error: "missing_gateId" });

    const record = await registry.getOrCreate({
      id, tenantId,
      name:             String(body.name     || "").trim()  || undefined,
      nationality:      String(body.nationality || "").trim() || undefined,
      locale:           String(body.locale   || "").trim()  || undefined,
      needsWheelchair:  !!body.needsWheelchair,
      plan:             body.plan === "premium" ? "premium" : "free",
      flightId, gateId,
      inboundFlightId:  canonicalFlightId(body.inboundFlightId || body.arr) || undefined,
      inboundFrom:      String(body.inboundFrom     || "").trim() || undefined,
      outboundTo:       String(body.outboundTo      || "").trim() || undefined,
      source: "manual",
    });

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "passenger_create",
      tenantId, passengerId: id,
    });
    return res.status(201).json({ ok: true, passenger: record });
  });

  /** PATCH /api/passengers/:id — update extStatus, activity, plan, etc. (admin/ops) */
  router.patch("/:id", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const tenantId    = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = req.params.id ?? "";
    const body        = req.body || {};

    const allowed = ["name", "nationality", "locale", "needsWheelchair", "plan",
                     "flightId", "gateId", "extStatus", "activity"] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.flightId !== undefined) patch.flightId = canonicalFlightId(patch.flightId);
    if (patch.gateId !== undefined) patch.gateId = canonicalGateId(patch.gateId);

    if (patch.plan !== undefined && !VALID_PLANS.has(patch.plan as PaxPlan)) {
      return res.status(400).json({ ok: false, error: "invalid_plan", allowed: [...VALID_PLANS] });
    }
    if (patch.extStatus !== undefined && !VALID_EXT_STATUSES.has(patch.extStatus as PaxExtStatus)) {
      return res.status(400).json({ ok: false, error: "invalid_ext_status", allowed: [...VALID_EXT_STATUSES] });
    }
    if (patch.activity !== undefined && !VALID_ACTIVITIES.has(patch.activity as PassengerActivity)) {
      return res.status(400).json({ ok: false, error: "invalid_activity", allowed: [...VALID_ACTIVITIES] });
    }

    const updated = await registry.update(tenantId, passengerId, patch);
    if (!updated) return res.status(404).json({ ok: false, error: "passenger_not_found" });

    // plan/capabilities are frozen into the passenger's session JWT at issue
    // time (paxSessionToken.ts) — without this, a plan downgrade wouldn't
    // take effect until whatever session they're currently holding expires
    // naturally (up to 30 days for a registered account).
    if (patch.plan !== undefined) {
      await revokePaxSessionsForPassenger(tenantId, passengerId);
    }

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "passenger_update",
      tenantId, passengerId,
      detail: Object.keys(patch).join(","),
    });
    return res.json({ ok: true, passenger: updated });
  });

  /**
   * GET /api/passengers/:id/export — admin only. Bundles everything stored
   * about one passenger (registry record, chat history, push subscription
   * endpoints, audit trail) into a single JSON response — the export/access
   * counterpart to DELETE's erasure, for a data subject access request.
   */
  router.get("/:id/export", requireRole("admin"), async (req: Request, res: Response) => {
    const tenantId    = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = req.params.id ?? "";

    const record = await registry.get(tenantId, passengerId);
    if (!record) return res.status(404).json({ ok: false, error: "passenger_not_found" });

    const [chatHistory, pushSubscriptions, auditTrail] = await Promise.all([
      store.ensureChatHistory(tenantId, passengerId),
      pushSubs?.list(HubStore.key(tenantId, passengerId)) ?? Promise.resolve([]),
      auditLog?.listForPassenger(tenantId, passengerId) ?? Promise.resolve([]),
    ]);

    // Exporting a passenger's full data bundle is itself a sensitive,
    // auditable action — same bar as the delete below.
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "passenger_data_export",
      tenantId, passengerId,
    });

    return res.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      passenger: record,
      chatHistory,
      pushSubscriptions,
      auditTrail,
    });
  });

  /** DELETE /api/passengers/:id — admin only. Cascades to chat history and push subscriptions. */
  router.delete("/:id", requireRole("admin"), async (req: Request, res: Response) => {
    const tenantId    = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = req.params.id ?? "";
    const deleted = await registry.delete(tenantId, passengerId);
    if (!deleted) return res.status(404).json({ ok: false, error: "passenger_not_found" });

    const { chatRowsDeleted } = await store.purgePassenger(tenantId, passengerId);
    await pushSubs?.removeAllForKey(HubStore.key(tenantId, passengerId));
    await revokePaxSessionsForPassenger(tenantId, passengerId);

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "passenger_delete",
      tenantId, passengerId,
      detail: `chat_rows=${chatRowsDeleted}`,
    });
    return res.json({ ok: true });
  });
}
