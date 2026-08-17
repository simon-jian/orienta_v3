import crypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import type { Router, Request, Response } from "express";
import { KIOSK_SCAN_SECRET, ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type { PaxAccountStore } from "../passengers/PaxAccountStore";
import { parseBcbp } from "../passengers/bcbpParser";
import { bearerTokenFromHeader, verifyPaxSessionToken } from "../passengers/paxSessionToken";
import {
  createSessionResponse,
  temporaryExpiryFromDeparture,
  REGISTERED_SESSION_TTL_MS,
  type AccountType,
  type PaxSessionResponse,
} from "../passengers/paxSessionMint";
import { resolveOutbound as resolveOutboundFlight } from "../services/fidsService";
import { airportForTenant, getTenant } from "../../src/config/tenants/registry";
import { requireRole, requireTenantAccess, adminEmailFromRequest } from "./auth";
import type { AuditLog } from "../lib/auditLog";
import type { PaxPlan } from "../../src/types/types";
import { canonicalTenantId, canonicalFlightId, canonicalGateId } from "../lib/canonicalize";

/** BCBP boarding passes are ~60-120 chars; cap generously to block payload abuse. */
const MAX_BCBP_PAYLOAD_LEN = 512;

/**
 * Constant-time comparison of the request's kiosk secret against the
 * configured value. When KIOSK_SCAN_SECRET is unset, scanning stays open
 * (dev convenience) — validateProductionSecurity() refuses to boot with it
 * unset in production, so this only "fails open" in non-production.
 *
 * Kiosk-only for POST /scan. Phone browsers use POST /boarding-pass instead
 * (no secret). Never embed KIOSK_SCAN_SECRET in frontend code.
 */
function isKioskAuthorized(req: Request): boolean {
  if (!KIOSK_SCAN_SECRET) return true;
  const provided = String(req.headers["x-kiosk-secret"] || "");
  const expected = KIOSK_SCAN_SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type BcbpSource = "qr_scan" | "phone_bcbp";

async function mintSessionFromBcbp(
  registry: PassengerRegistry,
  body: Record<string, unknown>,
  source: BcbpSource,
): Promise<{ parsed: ReturnType<typeof parseBcbp>; session: PaxSessionResponse }> {
  const tenantId = tenantFromBody(body);
  const payload = String(body.payload || body.bcbp || "").trim();
  if (!payload) throw new Error("missing_bcbp_payload");
  if (payload.length > MAX_BCBP_PAYLOAD_LEN) throw new Error("bcbp_payload_too_large");

  const parsed = parseBcbp(payload);
  const firstLeg = parsed.legs[0]!;
  const outboundLeg = parsed.legs[parsed.legs.length - 1]!;
  const outbound = await resolveOutboundFlight(
    canonicalFlightId(body.departureFlight || outboundLeg.flightId),
    canonicalGateId(body.gateId) || undefined,
    outboundLeg.toAirport,
    airportForTenant(tenantId),
  );
  const idPrefix = source === "phone_bcbp" ? "PHONE" : "TMP";
  const passengerId = passengerIdFromStableParts(idPrefix, [
    tenantId,
    parsed.passengerName,
    outboundLeg.flightId,
    outboundLeg.julianDate,
    outboundLeg.sequenceNumber,
  ]);
  const created = await registry.getOrCreate({
    id: passengerId,
    tenantId,
    name: parsed.passengerName || String(body.name || "").trim() || "Unknown",
    plan: "premium",
    flightId: outbound.flightId,
    gateId: outbound.gateId,
    inboundFlightId: firstLeg === outboundLeg ? undefined : firstLeg.flightId,
    inboundFrom: firstLeg.fromAirport || undefined,
    outboundTo: outbound.outboundTo || outboundLeg.toAirport || undefined,
    source,
  });
  // See the account-login path: getOrCreate is insert-or-ignore, so a rescanned
  // boarding pass would otherwise leave the operator on the previous itinerary.
  const passenger =
    (await registry.applyTrip(tenantId, passengerId, {
      flightId: outbound.flightId,
      gateId: outbound.gateId,
      inboundFlight: firstLeg === outboundLeg ? undefined : firstLeg.flightId,
      inboundFrom: firstLeg.fromAirport || undefined,
      outboundTo: outbound.outboundTo || outboundLeg.toAirport || undefined,
    })) ?? created;

  const session = await createSessionResponse({
    passenger,
    tenantId,
    accountType: "temporary",
    plan: "premium",
    expiresAt: temporaryExpiryFromDeparture(outbound.scheduledDepMs),
  });
  return { parsed, session };
}

/**
 * Resolve a tenant id from a public, unauthenticated request body. Falls back
 * to the deployment default rather than trusting an arbitrary caller-supplied
 * string — otherwise anyone could mint free-plan sessions/registry rows under
 * a made-up (or a *different*, real) tenant id, from the /scan and
 * /basic-session endpoints, which have no other tenant binding available.
 */
function tenantFromBody(body: Record<string, unknown>): string {
  const requested = canonicalTenantId(body.tenantId || body.tenant_id);
  // getTenant() itself lowercases before its lookup, but the *canonical*
  // (lowercased) form is what must actually get stored/keyed on below —
  // otherwise "AirChina" and "airchina" resolve to the same airport but
  // partition into different rows in the passenger registry/chat/metrics
  // tables.
  return requested && getTenant(requested) ? requested : canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
}

function passengerIdFromStableParts(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 12).toUpperCase();
  return `${prefix}_${hash}`;
}

export function registerPaxSessionRoutes(
  router: Router,
  registry: PassengerRegistry,
  accountStore: PaxAccountStore,
  auditLog?: AuditLog,
): void {
  const auditSession = (tenantId: string, passengerId: string, accountType: AccountType, plan: PaxPlan) => {
    void auditLog?.record({
      actorEmail: `pax:${passengerId}`,
      action: "pax_session_create",
      tenantId, passengerId,
      detail: `${accountType}/${plan}`,
    });
  };

  router.post("/scan", async (req: Request, res: Response) => {
    if (!isKioskAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "kiosk_not_authenticated" });
    }
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const { parsed, session } = await mintSessionFromBcbp(registry, body, "qr_scan");
      auditSession(session.passenger.tenantId, session.passenger.id, "temporary", "premium");
      return res.status(201).json({ ok: true, bcbp: parsed, session });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "scan_failed" });
    }
  });

  /**
   * Phone / PWA boarding-pass claim. Same BCBP parse + premium mint as kiosk
   * /scan, but no kiosk secret (browsers must never hold KIOSK_SCAN_SECRET).
   * Protect with a stricter rate limit at mount time.
   */
  router.post("/boarding-pass", async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const { parsed, session } = await mintSessionFromBcbp(registry, body, "phone_bcbp");
      auditSession(session.passenger.tenantId, session.passenger.id, "temporary", "premium");
      return res.status(201).json({ ok: true, bcbp: parsed, session });
    } catch (err) {
      const message = err instanceof Error ? err.message : "boarding_pass_failed";
      const status =
        message === "missing_bcbp_payload" || message === "bcbp_payload_too_large" ? 400 : 400;
      return res.status(status).json({ ok: false, error: message });
    }
  });

  router.post("/basic-session", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const tenantId = tenantFromBody(body);
    const rawIntent = String(body.intent || "").trim().toLowerCase();
    const singleFlight = canonicalFlightId(
      body.flight || body.departureFlight || body.dep || body.arrivalFlight || body.arr,
    );
    let departureFlight = canonicalFlightId(body.departureFlight || body.dep);
    let arrivalFlight = canonicalFlightId(body.arrivalFlight || body.arr);

    // Infer intent when omitted: two distinct flights → transfer; else depart.
    let intent: "depart" | "arrive" | "transfer" =
      rawIntent === "arrive" || rawIntent === "transfer" || rawIntent === "depart"
        ? rawIntent
        : departureFlight && arrivalFlight && departureFlight !== arrivalFlight
          ? "transfer"
          : "depart";

    if (intent === "transfer") {
      if (!arrivalFlight || !departureFlight) {
        return res.status(400).json({ ok: false, error: "missing_transfer_flights" });
      }
      if (arrivalFlight === departureFlight) {
        return res.status(400).json({ ok: false, error: "transfer_flights_must_differ" });
      }
    } else {
      const flight = singleFlight || departureFlight || arrivalFlight;
      if (!flight) return res.status(400).json({ ok: false, error: "missing_flight" });
      departureFlight = flight;
      arrivalFlight = flight;
    }

    const normalizeDate = (value: unknown): string | null => {
      const raw = String(value || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    };
    const date = normalizeDate(body.date);
    const arrivalDate = normalizeDate(body.arrivalDate) || date;
    const departureDate = normalizeDate(body.departureDate) || date;

    const outbound = await resolveOutboundFlight(
      departureFlight!,
      canonicalGateId(body.gateId) || undefined,
      undefined,
      airportForTenant(tenantId),
    );
    const passengerId = passengerIdFromStableParts("BASIC", [
      tenantId,
      intent,
      arrivalFlight || "",
      departureFlight || "",
      String(body.name || "").trim(),
    ]);
    const passenger = await registry.getOrCreate({
      id: passengerId,
      tenantId,
      name: String(body.name || "").trim() || "Guest",
      plan: "free",
      flightId: outbound.flightId,
      gateId: outbound.gateId,
      inboundFlightId: intent === "depart" ? undefined : arrivalFlight || undefined,
      outboundTo: outbound.outboundTo || undefined,
      source: "manual",
    });

    const session = await createSessionResponse({
      passenger,
      tenantId,
      accountType: "temporary",
      plan: "free",
      expiresAt: temporaryExpiryFromDeparture(outbound.scheduledDepMs),
    });
    auditSession(tenantId, passenger.id, "temporary", "free");
    return res.status(201).json({
      ok: true,
      session,
      trip: {
        intent,
        flight: intent === "transfer" ? undefined : departureFlight,
        date: intent === "transfer" ? undefined : departureDate || arrivalDate,
        arrivalFlight: intent === "transfer" || intent === "arrive" ? arrivalFlight : undefined,
        departureFlight: intent === "transfer" || intent === "depart" ? departureFlight : undefined,
        arrivalDate: intent === "transfer" ? arrivalDate : undefined,
        departureDate: intent === "transfer" ? departureDate : undefined,
      },
    });
  });

  router.post("/account-login", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const departureFlight = canonicalFlightId(body.departureFlight || body.dep);
    if (!email || !password) return res.status(400).json({ ok: false, error: "missing_credentials" });
    if (!departureFlight) return res.status(400).json({ ok: false, error: "missing_departure_flight" });

    const account = await accountStore.verifyLogin(email, password);
    if (!account) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    // Always the account's own bound tenant, never a body-supplied one —
    // otherwise any valid premium credentials could mint a session for a
    // tenant the account was never assigned to.
    const tenantId = account.tenantId;

    const outbound = await resolveOutboundFlight(departureFlight, canonicalGateId(body.gateId) || undefined, undefined, airportForTenant(tenantId));
    const passengerId = passengerIdFromStableParts("ACCT", [tenantId, email]);
    const created = await registry.getOrCreate({
      id: passengerId,
      tenantId,
      name: String(body.name || account.displayName || "").trim() || "Premium Passenger",
      plan: "premium",
      flightId: outbound.flightId,
      gateId: outbound.gateId,
      inboundFlightId: canonicalFlightId(body.arrivalFlight || body.arr) || undefined,
      outboundTo: outbound.outboundTo || undefined,
      source: "account_login",
    });
    // A returning account keeps its registry row, and getOrCreate ignores every
    // field for a row that already exists — so the flight just signed in with has
    // to be pushed through explicitly, or the operator keeps seeing the old one.
    const passenger =
      (await registry.applyTrip(tenantId, passengerId, {
        flightId: outbound.flightId,
        gateId: outbound.gateId,
        inboundFlight: canonicalFlightId(body.arrivalFlight || body.arr) || undefined,
        outboundTo: outbound.outboundTo || undefined,
      })) ?? created;

    const session = await createSessionResponse({
      passenger,
      tenantId,
      accountType: "registered",
      plan: "premium",
      expiresAt: Date.now() + REGISTERED_SESSION_TTL_MS,
    });
    auditSession(tenantId, passenger.id, "registered", "premium");
    return res.status(201).json({ ok: true, session });
  });

  // ── Admin: premium account management (P0-13) — beyond the env seed ──────────
  router.get("/accounts", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const tenantId = canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    res.json({ ok: true, accounts: await accountStore.listAccounts(tenantId) });
  });

  router.post("/accounts", requireRole("admin"), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return res.status(400).json({ ok: false, error: "missing_credentials" });
    const tenantId = canonicalTenantId(body.tenantId || body.tenant_id) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const account = await accountStore.upsertAccount({
      email,
      password,
      tenantId,
      displayName: String(body.displayName || body.display_name || "").trim() || undefined,
    });
    void auditLog?.record({ actorEmail: adminEmailFromRequest(req), action: "pax_account_upsert", detail: email });
    return res.status(201).json({ ok: true, account });
  });

  router.delete("/accounts/:email", requireRole("admin"), async (req: Request, res: Response) => {
    const email = String(req.params.email || "");
    const existing = await accountStore.getAccount(email);
    if (!existing) return res.status(404).json({ ok: false, error: "account_not_found" });
    if (!requireTenantAccess(req, res, existing.tenantId)) return;
    const deleted = await accountStore.deleteAccount(email);
    if (!deleted) return res.status(404).json({ ok: false, error: "account_not_found" });
    void auditLog?.record({ actorEmail: adminEmailFromRequest(req), action: "pax_account_delete", detail: email });
    return res.json({ ok: true });
  });

  router.get("/session", async (req: Request, res: Response) => {
    const token = bearerTokenFromHeader(req.headers.authorization);
    if (!token) return res.status(401).json({ ok: false, error: "missing_session_token" });

    const payload = await verifyPaxSessionToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: "session_invalid_or_expired" });

    const tenantId = String(payload.tenantId || "");
    const passengerId = String(payload.sub || "");
    const passenger = tenantId && passengerId ? await registry.get(tenantId, passengerId) : null;
    if (!passenger) return res.status(404).json({ ok: false, error: "passenger_not_found" });
    return res.json({
      ok: true,
      session: {
        token,
        passenger,
        accountType: payload.accountType,
        plan: payload.plan,
        capabilities: payload.capabilities,
        airportId: payload.airportId ?? airportForTenant(tenantId),
        expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null,
      },
    });
  });
}
