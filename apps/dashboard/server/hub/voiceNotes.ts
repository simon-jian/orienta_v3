import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import type { ChatKind, ChatMessage } from "../../src/types/types";
import { VOICE_NOTES_DIR } from "../paths";
import { HubStore } from "./HubStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isVoiceNoteId(raw: string): boolean {
  return UUID_RE.test(String(raw || "").trim());
}

function formatVoiceNoteBody(id: string, durationSec: number): string {
  return `${id}|${Math.max(0, Math.round(durationSec))}`;
}

export type VoiceNoteMeta = {
  id: string;
  tenantId: string;
  passengerId: string;
  from: "admin" | "pax";
  durationSec: number;
  mime: string;
  createdAt: number;
  file: string;
};

const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "application/octet-stream",
]);

export function normalizeVoiceMime(raw: string | undefined): string | null {
  const mime = String(raw || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!mime) return "audio/webm";
  if (mime === "audio/webm" || mime === "audio/ogg" || mime === "audio/mp4" || mime === "application/octet-stream") {
    return mime === "application/octet-stream" ? "audio/webm" : mime;
  }
  if (ALLOWED_MIME.has(String(raw || "").toLowerCase())) {
    return mime || "audio/webm";
  }
  return null;
}

function extForMime(mime: string): string {
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "audio/mp4") return ".m4a";
  return ".webm";
}

export function aacSidecarName(id: string): string {
  return `${id}.m4a`;
}

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      output,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += String(chunk); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg ${code}`));
    });
  });
}

export async function transcodeVoiceNoteToAac(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg(inputPath, outputPath);
}

/** Chrome records WebM/Opus; iPad Safari cannot play that. Serve AAC when we can. */
export async function bytesForVoicePlayback(loaded: {
  meta: VoiceNoteMeta;
  bytes: Buffer;
}): Promise<{ bytes: Buffer; mime: string }> {
  if (loaded.meta.mime === "audio/mp4") {
    return { bytes: loaded.bytes, mime: "audio/mp4" };
  }
  const sidecar = path.join(VOICE_NOTES_DIR, aacSidecarName(loaded.meta.id));
  try {
    const existing = await readFile(sidecar);
    if (existing.length) return { bytes: existing, mime: "audio/mp4" };
  } catch {
    /* transcode below */
  }
  try {
    await transcodeVoiceNoteToAac(path.join(VOICE_NOTES_DIR, loaded.meta.file), sidecar);
    const converted = await readFile(sidecar);
    if (converted.length) return { bytes: converted, mime: "audio/mp4" };
  } catch {
    /* keep the original for Chrome / Android */
  }
  return { bytes: loaded.bytes, mime: loaded.meta.mime };
}

export async function saveVoiceNote(opts: {
  tenantId: string;
  passengerId: string;
  from: "admin" | "pax";
  durationMs: number;
  mime: string;
  bytes: Buffer;
}): Promise<VoiceNoteMeta> {
  const id = crypto.randomUUID();
  const mime = normalizeVoiceMime(opts.mime) || "audio/webm";
  const file = `${id}${extForMime(mime)}`;
  await mkdir(VOICE_NOTES_DIR, { recursive: true });
  const meta: VoiceNoteMeta = {
    id,
    tenantId: opts.tenantId,
    passengerId: opts.passengerId,
    from: opts.from,
    durationSec: Math.max(0, Math.round(opts.durationMs / 1000)),
    mime,
    createdAt: Date.now(),
    file,
  };
  await writeFile(path.join(VOICE_NOTES_DIR, file), opts.bytes);
  await writeFile(path.join(VOICE_NOTES_DIR, `${id}.json`), JSON.stringify(meta));
  if (mime !== "audio/mp4") {
    void transcodeVoiceNoteToAac(
      path.join(VOICE_NOTES_DIR, file),
      path.join(VOICE_NOTES_DIR, aacSidecarName(id)),
    ).catch(() => undefined);
  }
  return meta;
}

export async function loadVoiceNote(id: string): Promise<{ meta: VoiceNoteMeta; bytes: Buffer } | null> {
  if (!isVoiceNoteId(id)) return null;
  try {
    const raw = await readFile(path.join(VOICE_NOTES_DIR, `${id}.json`), "utf8");
    const meta = JSON.parse(raw) as VoiceNoteMeta;
    if (!meta?.file || path.basename(meta.file) !== meta.file) return null;
    const bytes = await readFile(path.join(VOICE_NOTES_DIR, meta.file));
    return { meta, bytes };
  } catch {
    return null;
  }
}

export function appendVoiceChat(
  store: HubStore,
  meta: VoiceNoteMeta,
): ChatMessage {
  const chatMsg: ChatMessage = {
    id: crypto.randomUUID(),
    passengerId: meta.passengerId,
    tenantId: meta.tenantId,
    from: meta.from,
    kind: "voice" as ChatKind,
    body: formatVoiceNoteBody(meta.id, meta.durationSec),
    createdAt: meta.createdAt,
  };
  store.appendChat(meta.tenantId, meta.passengerId, chatMsg);
  store.broadcastAdmins(meta.tenantId, { type: "chat_msg", message: chatMsg });
  store.broadcastPax(meta.tenantId, meta.passengerId, { type: "chat_msg", message: chatMsg });
  return chatMsg;
}
