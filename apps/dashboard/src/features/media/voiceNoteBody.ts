/** Chat `kind: "voice"` body is a short `id|seconds` string — not the audio bytes. */

export function formatVoiceNoteBody(id: string, durationSec: number): string {
  return `${id}|${Math.max(0, Math.round(durationSec))}`;
}

export function parseVoiceNoteBody(body: string): { id: string; durationSec: number } | null {
  const raw = String(body || "").trim();
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) return null;
  const id = raw.slice(0, sep).trim();
  const durationSec = Number(raw.slice(sep + 1));
  if (!id || id.length > 80 || !Number.isFinite(durationSec)) return null;
  return { id, durationSec: Math.max(0, Math.round(durationSec)) };
}

export function formatCallClock(durationMs: number): string {
  const sec = Math.max(0, Math.round(durationMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCallSummary(mode: "audio" | "video", durationMs: number): string {
  const clock = formatCallClock(durationMs);
  return mode === "video" ? `Video call · ${clock}` : `Voice call · ${clock}`;
}
