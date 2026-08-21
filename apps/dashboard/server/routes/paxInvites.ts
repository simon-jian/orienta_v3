/**
 * Device-bound passenger invite links.
 *
 * The back office issues one link per passenger from airline-supplied data
 * (passenger UUID + flight). Opening it claims the invite for that device and
 * mints a normal pax session, so the passenger lands in /pax/app with their
 * flight, airports and gate already resolved and never types anything. Every
 * later open must come from the same device.
 *
 * Redemption deliberately reuses the standard session mint rather than a
 * bespoke token: once the JWT exists, the existing WS hello marks the
 * passenger online and the operator dashboard reacts with no extra wiring.
 */
import type { Router, Request, Response } from "express";
import { ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type {
  PaxInvite,
  PaxInviteStore,
  InviteFlightSnapshot,
  InviteLeg,
} from "../passengers/PaxInviteStore";
import { HubStore } from "../hub/HubStore";
import type { PushSubscriptionStore } from "../passengers/PushSubscriptionStore";
import {
  createSessionResponse,
  temporaryExpiryFromDeparture,
} from "../passengers/paxSessionMint";
import { fetchFlightAware } from "../services/flightAware";
import { resolveOutbound } from "../services/fidsService";
import { airportForTenant } from "../../src/config/tenants/registry";
import { requireRole, requireTenantAccess, adminHasTenantAccess, adminEmailFromRequest } from "./auth";
import { revokePaxSessionsForPassenger } from "../auth/paxSessionRevocation";
import type { AuditLog } from "../lib/auditLog";
import { canonicalTenantId, canonicalFlightId, canonicalGateId } from "../lib/canonicalize";
import { summarizeDevice } from "../lib/deviceSummary";
import { publicOrigin } from "../lib/publicUrl";
import { logger } from "../lib/logger";
import {
  SMS_ERRORS,
  assertInviteSmsUrl,
  inviteSmsBody,
  isSmsConfigured,
  maskPhone,
  parseE164,
  readSmsConfig,
  sendTwilioSms,
} from "../lib/sms";
import { buildInviteClaimUrl } from "../lib/inviteClaimUrl";
import { tryRenderInviteQr, type InviteQr } from "../lib/inviteQr";
import { mailFromMismatch, readMailConfig, sendInviteMail } from "../lib/mail";

/** Links outlive a delayed flight but not the trip; long enough to send by SMS a day ahead. */
const INVITE_LIFETIME_MS = 48 * 60 * 60_000;
const MAX_DEVICE_ID_LEN = 200;
const MAX_PASSENGER_ID_LEN = 100;

function tenantFromQuery(req: Request): string {
  return canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * Secret is in `?t=` (Outlook / QR scanners drop `#t=`) and repeated as
 * `#t=` for older links. The claim page reads either form, then posts it
 * back and strips it from the address bar.
 */
function inviteUrl(req: Request, inviteId: string, token: string): string {
  return buildInviteClaimUrl(publicOrigin(req), inviteId, token);
}

type ResolvedFlight = {
  snapshot: InviteFlightSnapshot;
  /** Drives session expiry; for an arrival this is the scheduled arrival. */
  referenceTimeMs: number;
  /** The gate the passenger actually stands at for this leg. */
  gateId: string;
};

/**
 * Look up the leg the invite is about. An arrival needs the destination gate
 * and origin airport, which `resolveOutbound` does not surface — it is built
 * for departures — so inbound legs query AeroAPI directly with intent
 * "arrive".
 */
async function resolveInviteFlight(
  flightId: string,
  flightDate: string,
  leg: InviteLeg,
  airportId: string,
  gateHint?: string,
): Promise<ResolvedFlight> {
  try {
    const inst = await fetchFlightAware(flightId, {
      date: flightDate,
      intent: leg === "inbound" ? "arrive" : "depart",
    });
    const clean = (value: string): string => (value && value !== "—" ? value : "");
    const snapshot: InviteFlightSnapshot = {
      depIata: clean(inst.dep_iata),
      arrIata: clean(inst.arr_iata),
      depTerminal: clean(inst.dep_terminal),
      depGate: clean(inst.dep_gate).toUpperCase(),
      arrTerminal: clean(inst.arr_terminal),
      arrGate: clean(inst.arr_gate).toUpperCase(),
      scheduledDepUtc: inst.scheduled_out_utc,
      scheduledArrUtc: inst.scheduled_in_utc,
      status: clean(inst.status),
    };
    const referenceIso = leg === "inbound" ? inst.scheduled_in_utc : inst.scheduled_out_utc;
    const referenceMs = referenceIso ? Date.parse(referenceIso) : NaN;
    return {
      snapshot,
      referenceTimeMs: Number.isFinite(referenceMs) ? referenceMs : Date.now() + 90 * 60_000,
      gateId: gateHint || (leg === "inbound" ? snapshot.arrGate : snapshot.depGate),
    };
  } catch (err) {
    logger.warn("invite_flight_lookup_failed", {
      flightId,
      leg,
      error: err instanceof Error ? err.message : String(err),
    });
    // Departures still have the FIDS fallback chain (caller hint → airport
    // defaultGate). Arrivals have no equivalent, so the gate simply stays
    // blank until a later redemption re-resolves it.
    const fallback = await resolveOutbound(flightId, gateHint, undefined, airportId);
    return {
      snapshot: {
        depIata: "",
        arrIata: leg === "outbound" ? fallback.outboundTo : "",
        depTerminal: "",
        depGate: leg === "outbound" ? fallback.gateId : "",
        arrTerminal: "",
        arrGate: leg === "inbound" ? gateHint ?? "" : "",
        scheduledDepUtc: null,
        scheduledArrUtc: null,
        status: "",
      },
      referenceTimeMs: fallback.scheduledDepMs,
      gateId: gateHint || (leg === "outbound" ? fallback.gateId : ""),
    };
  }
}

/** Admin-facing shape. The token hash and device hash never leave the server. */
function publicInvite(invite: PaxInvite): Omit<PaxInvite, "flight"> & { flight: InviteFlightSnapshot } {
  return invite;
}

type SmsAttempt =
  | { sent: true; to: string }
  | { sent: false; error: string; status: number };

/**
 * Validate + send. The URL (and its `#t=` secret) is never written to logs
 * or the audit `detail` column — only a masked number.
 */
async function trySendInviteSms(opts: {
  phone: unknown;
  url: string;
  inviteId: string;
  expectedOrigin: string;
  flightId?: string;
}): Promise<SmsAttempt> {
  const config = readSmsConfig();
  if (!config) return { sent: false, error: SMS_ERRORS.not_configured, status: 503 };

  const phone = parseE164(opts.phone, config.defaultCountryCode);
  if (!phone.ok) return { sent: false, error: phone.error, status: 400 };

  const claim = assertInviteSmsUrl(opts.url, opts.inviteId, opts.expectedOrigin);
  if (!claim.ok) return { sent: false, error: claim.error, status: 400 };

  const sent = await sendTwilioSms(config, phone.e164, inviteSmsBody(claim.url, opts.flightId));
  if (!sent.ok) return { sent: false, error: sent.error, status: 502 };
  return { sent: true, to: maskPhone(phone.e164) };
}

function inviteStillSendable(invite: PaxInvite): boolean {
  return invite.isActive && !invite.revokedAt && Date.now() < invite.expiresAt;
}

async function trySendInviteEmail(opts: {
  email: unknown;
  url: string;
  inviteId: string;
  expectedOrigin: string;
  name?: string;
  flightId?: string;
  qr?: InviteQr | null;
}): Promise<SmsAttempt> {
  const sent = await sendInviteMail(
    {
      to: opts.email,
      url: opts.url,
      inviteId: opts.inviteId,
      expectedOrigin: opts.expectedOrigin,
      name: opts.name,
      flightId: opts.flightId,
    },
    opts.qr !== undefined ? { qr: opts.qr } : undefined,
  );
  return sent.ok
    ? { sent: true, to: sent.to }
    : { sent: false, error: sent.error, status: sent.status };
}

function emailStatus(): { emailConfigured: boolean; emailFromWarning: boolean } {
  const config = readMailConfig();
  return {
    emailConfigured: !!config,
    emailFromWarning: !!config && mailFromMismatch(config),
  };
}

function inviteVisibleToAdmin(req: Request, invite: PaxInvite | null): invite is PaxInvite {
  return !!invite && adminHasTenantAccess(req, invite.tenantId);
}

async function eraseInviteRecord(
  invite: PaxInvite,
  invites: PaxInviteStore,
  registry: PassengerRegistry,
  hub?: HubStore,
  pushSubs?: PushSubscriptionStore,
): Promise<{ inviteRemoved: boolean; passengerRemoved: boolean }> {
  await revokePaxSessionsForPassenger(invite.tenantId, invite.passengerId);
  const inviteRemoved = await invites.remove(invite.inviteId);
  const remaining = await invites.countForPassenger(invite.tenantId, invite.passengerId);
  let passengerRemoved = false;
  if (remaining === 0) {
    passengerRemoved = await registry.delete(invite.tenantId, invite.passengerId);
    if (passengerRemoved) {
      await hub?.purgePassenger(invite.tenantId, invite.passengerId);
      await pushSubs?.removeAllForKey(HubStore.key(invite.tenantId, invite.passengerId));
    }
  }
  return { inviteRemoved, passengerRemoved };
}

export function registerPaxInviteRoutes(
  router: Router,
  invites: PaxInviteStore,
  registry: PassengerRegistry,
  auditLog?: AuditLog,
  hub?: HubStore,
  pushSubs?: PushSubscriptionStore,
): void {
  /** POST /invites — issue a link. The secret is returned exactly once. */
  router.post("/invites", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const tenantId = canonicalTenantId(body.tenantId || body.tenant_id) || tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;

    const passengerId = String(body.passengerId || body.passenger_id || "").trim().slice(0, MAX_PASSENGER_ID_LEN);
    const flightId = canonicalFlightId(body.flightId || body.flight_id);
    const flightDate = normalizeDate(body.flightDate || body.flight_date) || todayUtc();
    const leg: InviteLeg = body.leg === "inbound" ? "inbound" : "outbound";
    const name = String(body.name || "").trim();

    if (!passengerId) return res.status(400).json({ ok: false, error: "missing_passengerId" });
    if (!flightId) return res.status(400).json({ ok: false, error: "missing_flightId" });

    const airportId = airportForTenant(tenantId);
    const resolved = await resolveInviteFlight(
      flightId,
      flightDate,
      leg,
      airportId,
      canonicalGateId(body.gateId || body.gate_id) || undefined,
    );

    // Pre-create the registry row so the passenger shows up in the operator
    // list before they ever open the link.
    await registry.getOrCreate({
      id: passengerId,
      tenantId,
      name: name || "Guest",
      plan: body.plan === "free" ? "free" : "premium",
      flightId,
      gateId: resolved.gateId,
      inboundFlightId: leg === "inbound" ? flightId : undefined,
      inboundFrom: leg === "inbound" ? resolved.snapshot.depIata || undefined : undefined,
      outboundTo: leg === "outbound" ? resolved.snapshot.arrIata || undefined : undefined,
      source: "api_import",
    });

    const { invite, token } = await invites.create({
      tenantId,
      passengerId,
      passengerName: name,
      flightId,
      flightDate,
      leg,
      flight: resolved.snapshot,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      createdBy: adminEmailFromRequest(req),
    });

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_create",
      tenantId,
      passengerId,
      detail: `${flightId}/${flightDate}/${leg}`,
    });

    const url = inviteUrl(req, invite.inviteId, token);
    const origin = publicOrigin(req);
    const qr = await tryRenderInviteQr(url);
    const phone = String(body.phone || "").trim();
    const email = String(body.email || "").trim();
    let sms: SmsAttempt | undefined;
    if (phone) {
      sms = await trySendInviteSms({
        phone,
        url,
        inviteId: invite.inviteId,
        expectedOrigin: origin,
        flightId,
      });
      if (sms.sent) {
        void auditLog?.record({
          actorEmail: adminEmailFromRequest(req),
          action: "pax_invite_sms",
          tenantId,
          passengerId,
          detail: sms.to,
        });
      }
    }

    let emailResult: SmsAttempt | undefined;
    if (email) {
      emailResult = await trySendInviteEmail({
        email,
        url,
        inviteId: invite.inviteId,
        expectedOrigin: origin,
        name: name || undefined,
        flightId,
        qr,
      });
      if (emailResult.sent) {
        void auditLog?.record({
          actorEmail: adminEmailFromRequest(req),
          action: "pax_invite_email",
          tenantId,
          passengerId,
          detail: emailResult.to,
        });
      }
    }

    return res.status(201).json({
      ok: true,
      invite: publicInvite(invite),
      url,
      qrDataUrl: qr?.dataUrl,
      publicOrigin: origin,
      smsConfigured: isSmsConfigured(),
      ...emailStatus(),
      sms,
      email: emailResult,
    });
  });

  /** GET /invites — operator list with binding status. */
  router.get("/invites", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const list = await invites.list(tenantId);
    return res.json({
      ok: true,
      tenantId,
      invites: list.map(publicInvite),
      publicOrigin: publicOrigin(req),
      smsConfigured: isSmsConfigured(),
      ...emailStatus(),
    });
  });

  /**
   * POST /invites/erase-inactive — drop expired/revoked invite rows. If a
   * passenger has no leftover invites, the registry row goes too.
   */
  router.post("/invites/erase-inactive", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const tenantId = tenantFromQuery(req);
    if (!requireTenantAccess(req, res, tenantId)) return;

    const stale = await invites.listInactive(tenantId);
    let erased = 0;
    let passengersRemoved = 0;
    for (const invite of stale) {
      const result = await eraseInviteRecord(invite, invites, registry, hub, pushSubs);
      if (result.inviteRemoved) erased += 1;
      if (result.passengerRemoved) passengersRemoved += 1;
      void auditLog?.record({
        actorEmail: adminEmailFromRequest(req),
        action: "pax_invite_erase",
        tenantId: invite.tenantId,
        passengerId: invite.passengerId,
      });
    }
    return res.json({ ok: true, erased, passengersRemoved });
  });

  /**
   * POST /invites/:id/sms — text the claim URL that is still on the operator's
   * screen. The server no longer has the secret, so the client must send `url`.
   */
  router.post("/invites/:id/sms", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const invite = await invites.get(String(req.params.id || ""));
    if (!inviteVisibleToAdmin(req, invite)) {
      return res.status(404).json({ ok: false, error: "invite_not_found" });
    }
    if (!inviteStillSendable(invite)) {
      return res.status(409).json({ ok: false, error: "invite_inactive" });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const sms = await trySendInviteSms({
      phone: body.phone,
      url: String(body.url || ""),
      inviteId: invite.inviteId,
      expectedOrigin: publicOrigin(req),
      flightId: invite.flightId,
    });
    if (!sms.sent) return res.status(sms.status).json({ ok: false, error: sms.error });

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_sms",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
      detail: sms.to,
    });
    return res.json({ ok: true, to: sms.to });
  });

  /**
   * POST /invites/:id/email — same as SMS: the secret is only on the operator's
   * screen, so the client posts `url` and we check it against this invite.
   */
  router.post("/invites/:id/email", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const invite = await invites.get(String(req.params.id || ""));
    if (!inviteVisibleToAdmin(req, invite)) {
      return res.status(404).json({ ok: false, error: "invite_not_found" });
    }
    if (!inviteStillSendable(invite)) {
      return res.status(409).json({ ok: false, error: "invite_inactive" });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const sent = await trySendInviteEmail({
      email: body.email,
      url: String(body.url || ""),
      inviteId: invite.inviteId,
      expectedOrigin: publicOrigin(req),
      name: invite.passengerName || undefined,
      flightId: invite.flightId,
    });
    if (!sent.sent) return res.status(sent.status).json({ ok: false, error: sent.error });

    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_email",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
      detail: sent.to,
    });
    return res.json({ ok: true, to: sent.to });
  });

  /** DELETE /invites/:id — revoke. */
  router.delete("/invites/:id", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const invite = await invites.get(String(req.params.id || ""));
    if (!inviteVisibleToAdmin(req, invite)) {
      return res.status(404).json({ ok: false, error: "invite_not_found" });
    }

    const revoked = await invites.revoke(invite.inviteId);
    await revokePaxSessionsForPassenger(invite.tenantId, invite.passengerId);
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_revoke",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
    });
    return res.json({ ok: true, revoked });
  });

  /** POST /invites/:id/erase — remove the invite row and orphaned passenger. */
  router.post("/invites/:id/erase", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const invite = await invites.get(String(req.params.id || ""));
    if (!inviteVisibleToAdmin(req, invite)) {
      return res.status(404).json({ ok: false, error: "invite_not_found" });
    }

    const result = await eraseInviteRecord(invite, invites, registry, hub, pushSubs);
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_erase",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
      detail: result.passengerRemoved ? "passenger_removed" : "invite_only",
    });
    return res.json({ ok: true, ...result });
  });

  /**
   * POST /invites/:id/reset-device — support path for a passenger who cleared
   * site data or changed phones. The next open re-binds.
   */
  router.post("/invites/:id/reset-device", requireRole("admin", "ops"), async (req: Request, res: Response) => {
    const invite = await invites.get(String(req.params.id || ""));
    if (!inviteVisibleToAdmin(req, invite)) {
      return res.status(404).json({ ok: false, error: "invite_not_found" });
    }

    await invites.resetDevice(invite.inviteId);
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "pax_invite_reset_device",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
    });
    return res.json({ ok: true, invite: publicInvite((await invites.get(invite.inviteId))!) });
  });

  /**
   * POST /invites/redeem — public. Claims the link for this device and mints
   * the pax session.
   *
   * Failures collapse to `invalid_link` so a caller holding only an invite id
   * cannot distinguish "wrong secret" from "no such invite" and enumerate ids.
   * `device_mismatch` is deliberately distinct: the passenger needs to be told
   * why their own link stopped working.
   */
  router.post("/invites/redeem", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const inviteId = String(body.inviteId || "").trim();
    const token = String(body.token || "").trim();
    const deviceId = String(body.deviceId || "").trim().slice(0, MAX_DEVICE_ID_LEN);

    if (!inviteId || !token) return res.status(400).json({ ok: false, error: "invalid_link" });
    if (!deviceId) return res.status(400).json({ ok: false, error: "missing_device_id" });

    // touchPoints comes from the claim page because the server cannot see it,
    // and it is the only way to tell an iPad from a Mac in Safari.
    const touchPoints = Number(body.touchPoints);
    const device = summarizeDevice(req, {
      touchPoints: Number.isFinite(touchPoints) ? touchPoints : 0,
    });

    const result = await invites.redeem(inviteId, token, deviceId, device);
    if (!result.ok) {
      if (result.reason === "device_mismatch") {
        return res.status(403).json({ ok: false, error: "device_mismatch" });
      }
      if (result.reason === "expired" || result.reason === "revoked") {
        return res.status(410).json({ ok: false, error: result.reason });
      }
      return res.status(404).json({ ok: false, error: "invalid_link" });
    }

    const invite = result.invite;
    const airportId = airportForTenant(invite.tenantId);
    // Gate assignments move, and AeroAPI only publishes them close to the
    // flight, so the snapshot taken at issue time is treated as a hint only.
    const resolved = await resolveInviteFlight(invite.flightId, invite.flightDate, invite.leg, airportId);
    const snapshot = resolved.snapshot;
    const gateId =
      resolved.gateId ||
      (invite.leg === "inbound" ? invite.flight.arrGate : invite.flight.depGate);
    await invites.updateFlightSnapshot(invite.inviteId, snapshot);

    const created = await registry.getOrCreate({
      id: invite.passengerId,
      tenantId: invite.tenantId,
      name: invite.passengerName || "Guest",
      plan: "premium",
      flightId: invite.flightId,
      gateId,
      inboundFlightId: invite.leg === "inbound" ? invite.flightId : undefined,
      inboundFrom: invite.leg === "inbound" ? snapshot.depIata || undefined : undefined,
      outboundTo: invite.leg === "outbound" ? snapshot.arrIata || undefined : undefined,
      source: "api_import",
    });
    // getOrCreate is a no-op for the row the issue step already created, so the
    // freshly resolved itinerary has to be pushed through explicitly.
    const passenger =
      (await registry.applyTrip(invite.tenantId, invite.passengerId, {
        flightId: invite.flightId,
        gateId,
        inboundFlight: invite.leg === "inbound" ? invite.flightId : undefined,
        inboundFrom: invite.leg === "inbound" ? snapshot.depIata || undefined : undefined,
        outboundTo: invite.leg === "outbound" ? snapshot.arrIata || undefined : undefined,
      })) ?? created;

    const session = await createSessionResponse({
      passenger: { ...passenger, gateId: gateId || passenger.gateId },
      tenantId: invite.tenantId,
      accountType: "temporary",
      plan: "premium",
      expiresAt: temporaryExpiryFromDeparture(resolved.referenceTimeMs),
    });

    void auditLog?.record({
      actorEmail: `pax:${invite.passengerId}`,
      action: result.boundNow ? "pax_invite_device_bound" : "pax_invite_redeem",
      tenantId: invite.tenantId,
      passengerId: invite.passengerId,
      detail: `${invite.flightId}/${invite.leg}`,
    });

    return res.status(201).json({
      ok: true,
      session,
      boundNow: result.boundNow,
      trip: {
        intent: invite.leg === "inbound" ? "arrive" : "depart",
        flight: invite.flightId,
        date: invite.flightDate,
        arrivalFlight: invite.leg === "inbound" ? invite.flightId : undefined,
        departureFlight: invite.leg === "outbound" ? invite.flightId : undefined,
      },
      flight: {
        ...snapshot,
        flightId: invite.flightId,
        flightDate: invite.flightDate,
        leg: invite.leg,
        gateId,
      },
    });
  });
}
