/**
 * Web Push + pax presence HTTP fallback routes.
 * Extracted from the monolithic apiRoutes.ts.
 *
 * Needs HubStore access, so it receives the store as a parameter
 * rather than using module-level singletons.
 */
import crypto from "node:crypto";
import type { Router, Request, Response } from "express";
import webpush from "web-push";
import { HubStore, type RobotRequest, type RobotServiceType } from "../hub/HubStore";
import { setPaxPresenceFromHttp } from "../hub/presence";
import { handlePaxOutboundChat } from "../hub/chat";
import { storeAndBroadcastTrajectory, clearStoredTrajectory } from "../hub/trajectory";
import { resolvePaxIdentity } from "../passengers/paxIdentity";
import {
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
  isPushConfigured, ROUTE_SITE_DEFAULT_TENANT, TOURIST_ALLOWED_ORIGINS,
} from "../config";
import type { ChatKind, ChatMessage } from "../../src/types/types";
import { adminEmailFromRequest, requireAdmin, requireTenantAccess } from "./auth";
import { paxCanSendChat } from "../auth/paxAuthPolicy";
import type { AuditLog } from "../lib/auditLog";
import { PushSubscriptionStore, type PushSub } from "../passengers/PushSubscriptionStore";
import { logger } from "../lib/logger";
import { canonicalTenantId } from "../lib/canonicalize";
import { countTelemetryAccepted, countTelemetryRejected } from "../lib/telemetryStats";
// #region agent log
import { debugLog } from "../lib/debugLog";
// #endregion

const ROBOT_SERVICE_TYPES = new Set<RobotServiceType>([
  "follow",
  "um",
  "wheelchair",
  "lost_delivery",
]);

function parseRobotServiceType(raw: unknown): RobotServiceType | null {
  const value = String(raw || "").trim().toLowerCase() as RobotServiceType;
  return ROBOT_SERVICE_TYPES.has(value) ? value : null;
}

function robotServiceLabel(serviceType: RobotServiceType): string {
  switch (serviceType) {
    case "follow":
      return "跟随服务";
    case "um":
      return "UM 无人陪";
    case "wheelchair":
      return "特殊协助";
    case "lost_delivery":
      return "楼内递送";
    default:
      return serviceType;
  }
}

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
  const subs = await pushSubs.list(key);
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
      if (code === 404 || code === 410) await pushSubs.removeEndpoint(key, sub.endpoint);
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
    // #region agent log
    if (req.path.includes("tourist-")) {
      debugLog({
        runId: "post-fix", hypothesisId: "C",
        location: "server/routes/push.ts:122", message: "tourist identity rejected",
        data: {
          path: req.path,
          status: resolved.failure.status,
          error: resolved.failure.error,
          hasAuthHeader: !!req.headers.authorization,
        },
      });
    }
    // #endregion
    if (req.path.startsWith("/tourist-")) countTelemetryRejected();
    res.status(resolved.failure.status).json({ ok: false, error: resolved.failure.error });
    return null;
  }
  return resolved.identity;
}

// #region agent log
let touristPushSeq = 0;
function debugTouristEvent(message: string, hypothesisId: string, data: Record<string, unknown>): void {
  debugLog({ runId: "post-fix", hypothesisId, location: "server/routes/push.ts", message, data });
}
// #endregion

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
    await pushSubs.upsert(key, subscription);
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
      // Fires once per /away call; always clear so a repeat away/back cycle for
      // the same passenger doesn't leak a Map entry once this timer is done.
      awayTokens.delete(key);
      sendAwayPush(pushSubs, identity.tenantId, identity.passengerId).catch((err: unknown) => {
        // Must not become an unhandled rejection: errorTracking.ts now treats
        // those as fatal, and this fires from a bare setTimeout with no caller
        // to catch it.
        logger.error("away_push_failed", { error: err instanceof Error ? err.message : String(err) });
      });
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
    if (!paxCanSendChat(identity.claims, kind)) {
      return res.status(403).json({ ok: false, error: "chat_not_allowed_for_plan" });
    }
    if (!textBody)    return res.status(400).json({ ok: false, error: "missing_body" });
    if (textBody.length > 12000) return res.status(400).json({ ok: false, error: "body_too_large" });
    const gateRef = typeof body.gateRef === "string" ? body.gateRef : undefined;
    const msg = handlePaxOutboundChat(store, identity.tenantId, identity.passengerId, textBody, kind, gateRef);
    if (!msg) return res.status(503).json({ ok: false, error: "chat_hub_unavailable" });
    void auditLog?.record({
      actorEmail: `pax:${identity.passengerId}`,
      action: "pax_chat_send",
      tenantId: identity.tenantId, passengerId: identity.passengerId,
      detail: kind,
    });
    return res.json({ ok: true, message: msg });
  });

  router.get("/chat-history", async (req: Request, res: Response) => {
    const identity = await paxIdentityFromRequest(req, res, req.query as Record<string, unknown>);
    if (!identity) return;
    const messages = (await store.ensureChatHistory(identity.tenantId, identity.passengerId)).slice(-50);
    return res.json({ ok: true, messages });
  });

  // Admin chat HTTP fallback (trycloudflare / flaky WS).
  router.post("/admin-chat-send", requireAdmin, async (req: Request, res: Response) => {
    const body = req.body || {};
    const tenantId = canonicalTenantId(body.tenantId || body.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = String(body.passengerId || "").trim();
    const textBody = String(body.body || "").trim();
    const allowed = new Set(["text", "location", "system", "ai_agent", "operator"]);
    const kind = (allowed.has(String(body.kind || "text").toLowerCase())
      ? String(body.kind || "text").toLowerCase()
      : "text") as ChatKind;
    if (!passengerId) return res.status(400).json({ ok: false, error: "missing_passenger" });
    if (!textBody) return res.status(400).json({ ok: false, error: "missing_body" });
    if (textBody.length > 12000) return res.status(400).json({ ok: false, error: "body_too_large" });
    const gateRef = typeof body.gateRef === "string" ? body.gateRef : undefined;
    const chatMsg: ChatMessage = {
      id: crypto.randomUUID(),
      passengerId,
      tenantId,
      from: "admin",
      kind,
      body: textBody,
      gateRef,
      createdAt: Date.now(),
    };
    store.appendChat(tenantId, passengerId, chatMsg);
    store.broadcastAdmins(tenantId, { type: "chat_msg", message: chatMsg });
    store.broadcastPax(tenantId, passengerId, { type: "chat_msg", message: chatMsg });
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "admin_chat_send",
      tenantId,
      passengerId,
      detail: kind,
    });
    return res.json({ ok: true, message: chatMsg });
  });

  router.get("/admin-chat-history", requireAdmin, async (req: Request, res: Response) => {
    const tenantId = canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = String(req.query.passengerId || "").trim();
    if (!passengerId) return res.status(400).json({ ok: false, error: "missing_passenger" });
    const messages = (await store.ensureChatHistory(tenantId, passengerId)).slice(-50);
    return res.json({ ok: true, passengerId, messages });
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

  // ── Robot booking (ephemeral HubStore + admin notify) ─────────────────────────
  router.get("/robot-request", async (req: Request, res: Response) => {
    const identity = await paxIdentityFromRequest(req, res, req.query as Record<string, unknown>);
    if (!identity) return;
    const request = store.getRobotRequest(identity.tenantId, identity.passengerId) || null;
    return res.json({ ok: true, request });
  });

  router.post("/robot-request", async (req: Request, res: Response) => {
    const body = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;

    const serviceType = parseRobotServiceType(body.serviceType);
    if (!serviceType) return res.status(400).json({ ok: false, error: "invalid_service_type" });

    const partySize = Math.max(1, Math.min(6, Number(body.partySize) || 1));
    const origin = String(body.origin || "").trim().slice(0, 120) || "旅客当前位置";
    const destination = String(body.destination || "").trim().slice(0, 120) || "出发登机口";
    const note = String(body.note || "").trim().slice(0, 500);
    const now = Date.now();
    const existing = store.getRobotRequest(identity.tenantId, identity.passengerId);
    if (existing && existing.status !== "cancelled") {
      return res.status(409).json({ ok: false, error: "robot_request_active", request: existing });
    }

    const request: RobotRequest = {
      id: crypto.randomUUID(),
      serviceType,
      partySize,
      origin,
      destination,
      note,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    };
    store.setRobotRequest(identity.tenantId, identity.passengerId, request);

    const label = robotServiceLabel(serviceType);
    const sysMsg: ChatMessage = {
      id: crypto.randomUUID(),
      passengerId: identity.passengerId,
      tenantId: identity.tenantId,
      from: "system",
      kind: "system",
      body: `🤖 机器人服务请求：${label} · ${partySize}人 · ${origin} → ${destination}${note ? ` · ${note}` : ""}`,
      createdAt: now,
    };
    store.appendChat(identity.tenantId, identity.passengerId, sysMsg);
    store.broadcastAdmins(identity.tenantId, { type: "chat_msg", message: sysMsg });
    store.broadcastPax(identity.tenantId, identity.passengerId, { type: "chat_msg", message: sysMsg });
    const robotPayload = {
      type: "robot_request" as const,
      tenantId: identity.tenantId,
      passengerId: identity.passengerId,
      request,
      at: now,
    };
    store.broadcastAdmins(identity.tenantId, robotPayload);
    store.broadcastPax(identity.tenantId, identity.passengerId, {
      type: "robot_request_update",
      tenantId: identity.tenantId,
      passengerId: identity.passengerId,
      request,
      at: now,
    });

    void auditLog?.record({
      actorEmail: `pax:${identity.passengerId}`,
      action: "pax_robot_request",
      tenantId: identity.tenantId,
      passengerId: identity.passengerId,
      detail: serviceType,
    });

    return res.json({ ok: true, request });
  });

  router.delete("/robot-request", async (req: Request, res: Response) => {
    const body = req.body || {};
    const identity = await paxIdentityFromRequest(req, res, body);
    if (!identity) return;
    const existing = store.getRobotRequest(identity.tenantId, identity.passengerId);
    if (!existing) return res.json({ ok: true, request: null });
    const cancelled: RobotRequest = {
      ...existing,
      status: "cancelled",
      updatedAt: Date.now(),
    };
    store.clearRobotRequest(identity.tenantId, identity.passengerId);
    const payload = {
      type: "robot_request_cleared" as const,
      tenantId: identity.tenantId,
      passengerId: identity.passengerId,
      request: cancelled,
      at: cancelled.updatedAt,
    };
    store.broadcastAdmins(identity.tenantId, payload);
    store.broadcastPax(identity.tenantId, identity.passengerId, payload);
    return res.json({ ok: true, request: cancelled });
  });

  // Admin: list + advance robot booking status (mounted under /api/orienta too).
  router.get("/admin-robot-requests", requireAdmin, async (req: Request, res: Response) => {
    const tenantId = canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const prefix = `${tenantId}::`;
    const requests: Array<RobotRequest & { passengerId: string }> = [];
    for (const [key, request] of store.robotRequests) {
      if (!key.startsWith(prefix)) continue;
      if (request.status === "cancelled") continue;
      requests.push({ ...request, passengerId: key.slice(prefix.length) });
    }
    requests.sort((a, b) => b.createdAt - a.createdAt);
    return res.json({ ok: true, tenantId, requests });
  });

  router.post("/admin-robot-request", requireAdmin, async (req: Request, res: Response) => {
    const body = req.body || {};
    const tenantId = canonicalTenantId(body.tenantId || body.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = String(body.passengerId || "").trim();
    if (!passengerId) return res.status(400).json({ ok: false, error: "missing_passenger" });
    const existing = store.getRobotRequest(tenantId, passengerId);
    if (!existing) return res.status(404).json({ ok: false, error: "robot_request_not_found" });

    const action = String(body.action || "advance").trim().toLowerCase();
    const now = Date.now();
    if (action === "cancel") {
      const cancelled: RobotRequest = { ...existing, status: "cancelled", updatedAt: now };
      store.clearRobotRequest(tenantId, passengerId);
      const payload = {
        type: "robot_request_cleared" as const,
        tenantId,
        passengerId,
        request: cancelled,
        at: now,
      };
      store.broadcastAdmins(tenantId, payload);
      store.broadcastPax(tenantId, passengerId, payload);
      return res.json({ ok: true, request: cancelled });
    }

    const statusRaw = String(body.status || "").trim().toLowerCase();
    const allowed = new Set(["submitted", "assigned", "en_route", "serving"]);
    let nextStatus = existing.status;
    if (allowed.has(statusRaw)) {
      nextStatus = statusRaw as RobotRequest["status"];
    } else if (action === "advance") {
      const order = ["submitted", "assigned", "en_route", "serving"] as const;
      const idx = order.indexOf(existing.status as (typeof order)[number]);
      const nextIdx = Math.min(order.length - 1, Math.max(0, idx) + 1);
      nextStatus = order[nextIdx] ?? "serving";
    } else {
      return res.status(400).json({ ok: false, error: "invalid_status" });
    }

    const updated: RobotRequest = { ...existing, status: nextStatus, updatedAt: now };
    store.setRobotRequest(tenantId, passengerId, updated);
    const payload = {
      type: "robot_request_update" as const,
      tenantId,
      passengerId,
      request: updated,
      at: now,
    };
    store.broadcastAdmins(tenantId, payload);
    store.broadcastPax(tenantId, passengerId, payload);

    const sysMsg: ChatMessage = {
      id: crypto.randomUUID(),
      passengerId,
      tenantId,
      from: "system",
      kind: "system",
      body: `🤖 机器人服务状态更新：${updated.status}`,
      createdAt: now,
    };
    store.appendChat(tenantId, passengerId, sysMsg);
    store.broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
    store.broadcastPax(tenantId, passengerId, { type: "chat_msg", message: sysMsg });

    return res.json({ ok: true, request: updated });
  });

  // ── Admin presence poll ───────────────────────────────────────────────────────
  router.get("/admin-presence", requireAdmin, async (req: Request, res: Response) => {
    const tenantId = canonicalTenantId(req.query.tenant) || canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    // listOnlineGlobal (not listOnline) so this matches WS hello / GET
    // /api/passengers — otherwise this endpoint under-reports whoever is
    // connected to a *different* instance in a multi-instance (Redis) deploy.
    res.json({ ok: true, tenantId, online: await store.listOnlineGlobal(tenantId) });
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      countTelemetryRejected();
      return res.status(400).json({ ok: false, error: "missing_lat_lng" });
    }
    const ok = storeAndBroadcastTrajectory(store, identity.tenantId, identity.passengerId, Array.isArray(body.path) ? body.path : [], { lat, lng });
    // #region agent log
    touristPushSeq += 1;
    if (touristPushSeq <= 2 || touristPushSeq % 5 === 0 || !ok) {
      debugTouristEvent("tourist-position stored", "C", {
        seq: touristPushSeq,
        path: req.path,
        passengerId: identity.passengerId,
        tenantId: identity.tenantId,
        pathLen: Array.isArray(body.path) ? body.path.length : 0,
        stored: ok,
      });
    }
    // #endregion
    if (!ok) {
      countTelemetryRejected();
      return res.status(503).json({ ok: false, error: "hub_not_ready" });
    }
    countTelemetryAccepted();
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
    // #region agent log
    debugTouristEvent("tourist-deactivate cleared trajectory", "B", {
      path: req.path,
      passengerId: identity.passengerId,
      pushesBefore: touristPushSeq,
    });
    // #endregion
    return res.json({ ok: true });
  });
}
