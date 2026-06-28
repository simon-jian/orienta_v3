import crypto from "node:crypto";
import type { Router, Request, Response } from "express";
import { SignJWT } from "jose";
import { JWT_SECRET, ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { PassengerRegistry, PassengerRecord } from "../passengers/PassengerRegistry";
import type { PaxAccountStore } from "../passengers/PaxAccountStore";
import { parseBcbp } from "../passengers/bcbpParser";
import { bearerTokenFromHeader, PAX_SESSION_AUDIENCE, verifyPaxSessionToken } from "../passengers/paxSessionToken";
import { resolveOutbound as resolveOutboundFlight } from "../services/fidsService";
import { requireRole, adminEmailFromRequest } from "./auth";
import type { AuditLog } from "../lib/auditLog";
import type { PaxPlan } from "../../src/types/types";

type AccountType = "temporary" | "registered";

type PaxCapability =
  | "navigate"
  | "receive_notifications"
  | "share_location"
  | "operator_chat";

type PaxSessionResponse = {
  token: string;
  passenger: PassengerRecord;
  accountType: AccountType;
  plan: PaxPlan;
  capabilities: PaxCapability[];
  expiresAt: number;
};

const TEMP_SESSION_MIN_TTL_MS = 30 * 60_000;
const TEMP_SESSION_GRACE_MS = 2 * 60 * 60_000;
const REGISTERED_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

function tenantFromBody(body: Record<string, unknown>): string {
  return String(body.tenantId || body.tenant_id || ROUTE_SITE_DEFAULT_TENANT).trim();
}

function capabilitiesFor(plan: PaxPlan): PaxCapability[] {
  const base: PaxCapability[] = ["navigate", "receive_notifications", "share_location"];
  return plan === "premium" ? [...base, "operator_chat"] : base;
}

function normalizeFlightId(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

function temporaryExpiryFromDeparture(scheduledDepMs: number): number {
  return Math.max(Date.now() + TEMP_SESSION_MIN_TTL_MS, scheduledDepMs + TEMP_SESSION_GRACE_MS);
}

function passengerIdFromStableParts(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 12).toUpperCase();
  return `${prefix}_${hash}`;
}

async function signPaxSession(input: {
  passengerId: string;
  tenantId: string;
  accountType: AccountType;
  plan: PaxPlan;
  capabilities: PaxCapability[];
  expiresAt: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const sessionId = crypto.randomUUID();
  return new SignJWT({
    sid: sessionId,
    tenantId: input.tenantId,
    accountType: input.accountType,
    plan: input.plan,
    capabilities: input.capabilities,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(PAX_SESSION_AUDIENCE)
    .setAudience(PAX_SESSION_AUDIENCE)
    .setSubject(input.passengerId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(input.expiresAt / 1000))
    .sign(secret);
}

async function createSessionResponse(input: {
  passenger: PassengerRecord;
  tenantId: string;
  accountType: AccountType;
  plan: PaxPlan;
  expiresAt: number;
}): Promise<PaxSessionResponse> {
  const capabilities = capabilitiesFor(input.plan);
  const token = await signPaxSession({
    passengerId: input.passenger.id,
    tenantId: input.tenantId,
    accountType: input.accountType,
    plan: input.plan,
    capabilities,
    expiresAt: input.expiresAt,
  });
  return {
    token,
    passenger: input.passenger,
    accountType: input.accountType,
    plan: input.plan,
    capabilities,
    expiresAt: input.expiresAt,
  };
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
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const tenantId = tenantFromBody(body);
      const payload = String(body.payload || body.bcbp || "").trim();
      if (!payload) return res.status(400).json({ ok: false, error: "missing_bcbp_payload" });

      const parsed = parseBcbp(payload);
      const firstLeg = parsed.legs[0]!;
      const outboundLeg = parsed.legs[parsed.legs.length - 1]!;
      const outbound = await resolveOutboundFlight(
        String(body.departureFlight || outboundLeg.flightId),
        String(body.gateId || "").trim() || undefined,
        outboundLeg.toAirport,
      );
      const passengerId = passengerIdFromStableParts("TMP", [
        tenantId,
        parsed.passengerName,
        outboundLeg.flightId,
        outboundLeg.julianDate,
        outboundLeg.sequenceNumber,
      ]);
      const passenger = await registry.getOrCreate({
        id: passengerId,
        tenantId,
        name: parsed.passengerName || String(body.name || "").trim() || "Unknown",
        plan: "premium",
        flightId: outbound.flightId,
        gateId: outbound.gateId,
        inboundFlightId: firstLeg === outboundLeg ? undefined : firstLeg.flightId,
        inboundFrom: firstLeg.fromAirport || undefined,
        outboundTo: outbound.outboundTo || outboundLeg.toAirport || undefined,
        source: "qr_scan",
      });

      const session = await createSessionResponse({
        passenger,
        tenantId,
        accountType: "temporary",
        plan: "premium",
        expiresAt: temporaryExpiryFromDeparture(outbound.scheduledDepMs),
      });
      auditSession(tenantId, passenger.id, "temporary", "premium");
      return res.status(201).json({ ok: true, bcbp: parsed, session });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "scan_failed" });
    }
  });

  router.post("/basic-session", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const tenantId = tenantFromBody(body);
    const departureFlight = String(body.departureFlight || body.dep || "").trim();
    const arrivalFlight = String(body.arrivalFlight || body.arr || "").trim();
    if (!departureFlight) return res.status(400).json({ ok: false, error: "missing_departure_flight" });
    if (!arrivalFlight) return res.status(400).json({ ok: false, error: "missing_arrival_flight" });

    const outbound = await resolveOutboundFlight(departureFlight, String(body.gateId || "").trim() || undefined);
    const passengerId = passengerIdFromStableParts("BASIC", [
      tenantId,
      arrivalFlight,
      departureFlight,
      String(body.name || "").trim(),
    ]);
    const passenger = await registry.getOrCreate({
      id: passengerId,
      tenantId,
      name: String(body.name || "").trim() || "Guest",
      plan: "free",
      flightId: outbound.flightId,
      gateId: outbound.gateId,
      inboundFlightId: normalizeFlightId(arrivalFlight),
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
    return res.status(201).json({ ok: true, session });
  });

  router.post("/account-login", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const tenantId = tenantFromBody(body);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const departureFlight = String(body.departureFlight || body.dep || "").trim();
    if (!email || !password) return res.status(400).json({ ok: false, error: "missing_credentials" });
    if (!departureFlight) return res.status(400).json({ ok: false, error: "missing_departure_flight" });

    const account = await accountStore.verifyLogin(email, password);
    if (!account) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const outbound = await resolveOutboundFlight(departureFlight, String(body.gateId || "").trim() || undefined);
    const passengerId = passengerIdFromStableParts("ACCT", [tenantId, email]);
    const passenger = await registry.getOrCreate({
      id: passengerId,
      tenantId,
      name: String(body.name || account.displayName || "").trim() || "Premium Passenger",
      plan: "premium",
      flightId: outbound.flightId,
      gateId: outbound.gateId,
      inboundFlightId: String(body.arrivalFlight || body.arr || "").trim() || undefined,
      outboundTo: outbound.outboundTo || undefined,
      source: "account_login",
    });

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
  router.get("/accounts", requireRole("admin", "ops"), async (_req: Request, res: Response) => {
    res.json({ ok: true, accounts: await accountStore.listAccounts() });
  });

  router.post("/accounts", requireRole("admin"), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return res.status(400).json({ ok: false, error: "missing_credentials" });
    const account = await accountStore.upsertAccount({
      email,
      password,
      tenantId: String(body.tenantId || body.tenant_id || "").trim() || undefined,
      displayName: String(body.displayName || body.display_name || "").trim() || undefined,
    });
    void auditLog?.record({ actorEmail: adminEmailFromRequest(req), action: "pax_account_upsert", detail: email });
    return res.status(201).json({ ok: true, account });
  });

  router.delete("/accounts/:email", requireRole("admin"), async (req: Request, res: Response) => {
    const email = String(req.params.email || "");
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
        expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null,
      },
    });
  });
}
