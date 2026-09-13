import express, { type Router, type Request, type Response } from "express";
import { HubStore } from "../hub/HubStore";
import { appendVoiceChat, bytesForVoicePlayback, loadVoiceNote, normalizeVoiceMime, saveVoiceNote } from "../hub/voiceNotes";
import { resolvePaxIdentity } from "../passengers/paxIdentity";
import { adminEmailFromRequest, requireAdmin, requireTenantAccess } from "./auth";
import { adminAllowedForTenant, adminPayloadFromCookieHeader } from "../auth/adminAuth";
import { paxCanSendChat } from "../auth/paxAuthPolicy";
import { canonicalTenantId } from "../lib/canonicalize";
import { ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { AuditLog } from "../lib/auditLog";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_MS = 70_000;
const MIN_DURATION_MS = 400;

const rawAudio = express.raw({
  type: [
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "application/octet-stream",
  ],
  limit: MAX_BYTES,
});

function durationFromRequest(req: Request): number {
  const header = Number(req.headers["x-voice-duration-ms"]);
  if (Number.isFinite(header) && header > 0) return header;
  const q = Number(req.query.durationMs);
  return Number.isFinite(q) ? q : 0;
}

function audioBuffer(req: Request): Buffer | null {
  if (!Buffer.isBuffer(req.body)) return null;
  if (!req.body.length || req.body.length > MAX_BYTES) return null;
  return req.body;
}

export function registerPaxVoiceNoteRoute(router: Router, store: HubStore, auditLog?: AuditLog): void {
  router.post("/voice-note", rawAudio, async (req: Request, res: Response) => {
    const identity = await resolvePaxIdentity({
      authorizationHeader: req.headers.authorization,
    });
    if (!identity.ok) {
      return res.status(identity.failure.status).json({ ok: false, error: identity.failure.error });
    }
    if (!paxCanSendChat(identity.identity.claims, "voice")) {
      return res.status(403).json({ ok: false, error: "chat_not_allowed_for_plan" });
    }
    const mime = normalizeVoiceMime(req.headers["content-type"]);
    const bytes = audioBuffer(req);
    const durationMs = durationFromRequest(req);
    if (!mime || !bytes) return res.status(400).json({ ok: false, error: "invalid_audio" });
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return res.status(400).json({ ok: false, error: "invalid_duration" });
    }
    const meta = await saveVoiceNote({
      tenantId: identity.identity.tenantId,
      passengerId: identity.identity.passengerId,
      from: "pax",
      durationMs,
      mime,
      bytes,
    });
    const message = appendVoiceChat(store, meta);
    void auditLog?.record({
      actorEmail: `pax:${identity.identity.passengerId}`,
      action: "pax_voice_note",
      tenantId: identity.identity.tenantId,
      passengerId: identity.identity.passengerId,
      detail: meta.id,
    });
    return res.json({ ok: true, message, voiceNoteId: meta.id });
  });
}

export function registerAdminVoiceNoteRoute(router: Router, store: HubStore, auditLog?: AuditLog): void {
  router.post("/admin-voice-note", requireAdmin, rawAudio, async (req: Request, res: Response) => {
    const tenantId =
      canonicalTenantId(req.headers["x-tenant-id"] || req.query.tenant || req.query.tenantId) ||
      canonicalTenantId(ROUTE_SITE_DEFAULT_TENANT);
    if (!requireTenantAccess(req, res, tenantId)) return;
    const passengerId = String(req.headers["x-passenger-id"] || req.query.passengerId || "").trim();
    if (!passengerId) return res.status(400).json({ ok: false, error: "missing_passenger" });
    const mime = normalizeVoiceMime(req.headers["content-type"]);
    const bytes = audioBuffer(req);
    const durationMs = durationFromRequest(req);
    if (!mime || !bytes) return res.status(400).json({ ok: false, error: "invalid_audio" });
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return res.status(400).json({ ok: false, error: "invalid_duration" });
    }
    const meta = await saveVoiceNote({
      tenantId,
      passengerId,
      from: "admin",
      durationMs,
      mime,
      bytes,
    });
    const message = appendVoiceChat(store, meta);
    void auditLog?.record({
      actorEmail: adminEmailFromRequest(req),
      action: "admin_voice_note",
      tenantId,
      passengerId,
      detail: meta.id,
    });
    return res.json({ ok: true, message, voiceNoteId: meta.id });
  });
}

export function registerVoiceNoteGetRoute(router: Router): void {
  router.get("/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    const loaded = await loadVoiceNote(id);
    if (!loaded) return res.status(404).json({ ok: false, error: "not_found" });

    const playable = String(req.query.playable || "") === "1"
      ? await bytesForVoicePlayback(loaded)
      : { bytes: loaded.bytes, mime: loaded.meta.mime };

    const sendAudio = () => {
      res.setHeader("Content-Type", playable.mime);
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.send(playable.bytes);
    };

    const admin = await adminPayloadFromCookieHeader(req.headers.cookie);
    if (admin && adminAllowedForTenant(admin, loaded.meta.tenantId)) {
      return sendAudio();
    }

    const pax = await resolvePaxIdentity({ authorizationHeader: req.headers.authorization });
    if (
      pax.ok &&
      pax.identity.tenantId === loaded.meta.tenantId &&
      pax.identity.passengerId === loaded.meta.passengerId
    ) {
      return sendAudio();
    }

    return res.status(404).json({ ok: false, error: "not_found" });
  });
}

