/**
 * Web Push + pax presence HTTP fallback routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Needs HubStore access, so it receives the store as a parameter
 * rather than using module-level singletons.
 */
import type { Router, Request, Response } from "express";
import webpush from "web-push";
import { HubStore } from "../hub/HubStore";
import { setPaxPresenceFromHttp } from "../hub/presence";
import { handlePaxOutboundChat } from "../hub/chat";
import { storeAndBroadcastTrajectory, clearStoredTrajectory } from "../hub/trajectory";
import { resolvePaxIdentity } from "../passengers/paxIdentity";
import {
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
  isPushConfigured, ROUTE_SITE_DEFAULT_TENANT, TOURIST_ALLOWED_ORIGINS,
} from "../config";
import type { ChatKind } from "../../src/types/types";
import { requireAdmin } from "./auth";
import { paxCanSendChat } from "../auth/paxAuthPolicy";
import type { AuditLog } from "../lib/auditLog";
import { PushSubscriptionStore, type PushSub } from "../passengers/PushSubscriptionStore";

// ─── VAPID helpers ────────────────────────────────────────────────────────────

function getVapid(): { publicKey: string } | null {
  if (!isPushConfigured()) return null;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return { publicKey: VAPID_PUBLIC_KEY };
}

async function sendAwayPush(
  pushSubs: PushSubscriptionStore,
  tenantId: string,
  passengerId: string
): Promise<void> {
  const vapid = getVapid();
  if (!vapid) return;
  const key = HubStore.key(tenantId, passengerId);
  const subs = pushSubs.list(key);
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: "Orienta 提醒",
    body: "你已离开页面超过 30 秒，请返回继续查看路线。",
    // P1-8: React /pax/app is the canonical passenger surface (legacy pax.html is unlinked).
    url: `/pax/app?tenant=${encodeURIComponent(tenantId)}&pid=${encodeURIComponent(passengerId)}`,
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub as Parameters<typeof webpush.sendNotification>[0], payload);
    } catch (e: unknown) {
      const err = e as Record<string, unknown>;
      const code = typeof err.statusCode === "number" ? err.statusCode
        : typeof err.status === "number" ? err.status : 0;
      // Drop endpoints the push service has permanently rejected.
      if (code === 404 || code === 410) pushSubs.removeEndpoint(key, sub.endpoint);
    }
  }
}

/**
 * P0-7: tourist-position routes are cross-origin (route_site iframe / kiosks) but
 * carry NO cookies — identity comes from the body / bearer token. We therefore
 * scope the ACAO header to an env allowlist instead of a blanket "*".
 */
function corsTouristApi(req: Request, res: Response): void {
  const origin = String(req.headers.origin || "").trim();
  res.setHeader("Vary", "Origin");
  if (TOURIST_ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && TOURIST_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  // else: no ACAO header → same-origin requests still succeed; others are blocked.
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function paxIdentityFromRequest(req: Request, res: Response, body: Record<string, unknown>) {
  const resolved = await resolvePaxIdentity({
    authorizationHeader: req.headers.authorization,
    tenantId: body.tenantId,
    tenant_id: body.tenant_id,
    passengerId: body.passengerId,
    passenger_id: body.passenger_id,
  });
  if (!resolved.ok) {
    res.status(resolved.failure.status).json({ ok: false, error: resolved.failure.error });
    return null;
  }
  return resolved.identity;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerPushRoutes(
  router: Router,
  store: HubStore,
  pushSubs: PushSubscriptionStore,
  auditLog?: AuditLog,
): void {
  const awayTokens = new Map<string, string>();

  // ── VAPID public key ────────────────────────────────────────────────────────
  router.get("/vapidPublicKey", (_req, res: Response) => {
    const vapid = getVapid();
    if (!vapid) return res.status(503).json({ ok: false, error: "push_not_configured" });
    return res.json({ ok: true, publicKey: vapid.publicKey });
  });

  router.post("/subscribe", async (req: Request, res: Response) => {
    const body = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const subscription = body.subscription as PushSub | undefined;
    if (!subscription?.endpoint) return res.status(400).json({ ok: false, error: "missing_subscription" });
    const key = HubStore.key(identity.tenantId, identity.passengerId);
    pushSubs.upsert(key, subscription);
    return res.json({ ok: true });
  });

  // ── Away / back notifications ────────────────────────────────────────────────
  router.post("/away", async (req: Request, res: Response) => {
    const body = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const awayMs = Math.max(5000, Math.min(120000, Number(body.awayMs || 30000) || 30000));
    const key = HubStore.key(identity.tenantId, identity.passengerId);
    const token = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    awayTokens.set(key, token);
    setTimeout(() => {
      if (awayTokens.get(key) !== token) return;
      void sendAwayPush(pushSubs, identity.tenantId, identity.passengerId);
    }, awayMs);
    return res.json({ ok: true });
  });

  router.post("/back", async (req: Request, res: Response) => {
    const body = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    awayTokens.delete(HubStore.key(identity.tenantId, identity.passengerId));
    return res.json({ ok: true });
  });

  // ── Pax chat HTTP fallback ────────────────────────────────────────────────────
  router.post("/chat-send", async (req: Request, res: Response) => {
    const body       = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const textBody   = String(body.body || "").trim();
    const allowed    = new Set(["text", "location", "system", "ai_agent", "operator"]);
    const kind       = (allowed.has(String(body.kind || "text").toLowerCase()) ? String(body.kind || "text").toLowerCase() : "text") as ChatKind;
    if (identity.claims && !identity.claims.capabilities?.includes("operator_chat") && kind !== "location") {
      return res.status(403).json({ ok: false, error: "chat_not_allowed_for_plan" });
    }
    if (!identity.claims && !paxCanSendChat(null, store, identity.tenantId, identity.passengerId, kind)) {
      return res.status(403).json({ ok: false, error: "chat_not_allowed_for_plan" });
    }
    if (!textBody)    return res.status(400).json({ ok: false, error: "missing_body" });
    if (textBody.length > 12000) return res.status(400).json({ ok: false, error: "body_too_large" });
    const gateRef = typeof body.gateRef === "string" ? body.gateRef : undefined;
    const msg = handlePaxOutboundChat(store, identity.tenantId, identity.passengerId, textBody, kind, gateRef);
    if (!msg) return res.status(503).json({ ok: false, error: "chat_hub_unavailable" });
    auditLog?.record({
      actorEmail: `pax:${identity.passengerId}`,
      action: "pax_chat_send",
      tenantId: identity.tenantId, passengerId: identity.passengerId,
      detail: kind,
    });
    return res.json({ ok: true, message: msg });
  });

  // ── Pax presence HTTP heartbeat ───────────────────────────────────────────────
  router.post("/presence", async (req: Request, res: Response) => {
    const body        = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const onlineRaw   = body.online;
    const isOnline    = !(onlineRaw === false || onlineRaw === 0 || onlineRaw === "0");
    setPaxPresenceFromHttp(store, identity.tenantId, identity.passengerId, isOnline);
    return res.json({ ok: true, tenantId: identity.tenantId, passengerId: identity.passengerId, online: isOnline });
  });

  // ── Admin presence poll ───────────────────────────────────────────────────────
  router.get("/admin-presence", requireAdmin, (req: Request, res: Response) => {
    const tenantId = String(req.query.tenant || ROUTE_SITE_DEFAULT_TENANT).trim();
    res.json({ ok: true, tenantId, online: store.listOnline(tenantId) });
  });

  // ── Tourist position (route_site → back office) ───────────────────────────────
  router.options("/tourist-position",   (req, res) => { corsTouristApi(req, res); res.sendStatus(204); });
  router.options("/tourist-deactivate", (req, res) => { corsTouristApi(req, res); res.sendStatus(204); });

  router.post("/tourist-position", async (req: Request, res: Response) => {
    corsTouristApi(req, res);
    const body      = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const lat       = Number(body.lat);
    const lng       = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ ok: false, error: "missing_lat_lng" });
    const ok = storeAndBroadcastTrajectory(store, identity.tenantId, identity.passengerId, Array.isArray(body.path) ? body.path : [], { lat, lng });
    if (!ok) return res.status(503).json({ ok: false, error: "hub_not_ready" });
    setPaxPresenceFromHttp(store, identity.tenantId, identity.passengerId, true);
    return res.json({ ok: true });
  });

  router.post("/tourist-deactivate", async (req: Request, res: Response) => {
    corsTouristApi(req, res);
    let body: Record<string, unknown> = {};
    if (typeof req.body === "string") {
      const s = req.body.trim();
      if (s.includes("|")) {
        const parts = s.split("|");
        body = { tenantId: parts[0], passengerId: parts.slice(1).join("|") };
      } else {
        body = { passengerId: s };
      }
    } else if (req.body && typeof req.body === "object") {
      body = req.body as Record<string, unknown>;
    }
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    clearStoredTrajectory(store, identity.tenantId, identity.passengerId);
    return res.json({ ok: true });
  });
}
