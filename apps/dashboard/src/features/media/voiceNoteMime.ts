import { prefersAvThenStripAudio } from "./localMedia";

const APPLE_TYPES = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"];
const OTHER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function pickVoiceRecorderMime(
  isTypeSupported: (type: string) => boolean,
  apple = prefersAvThenStripAudio(),
): string {
  const types = apple ? APPLE_TYPES : OTHER_TYPES;
  return types.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  }) || "";
}

export function typedAudioBlob(blob: Blob, contentType: string | null | undefined): Blob {
  const type = String(contentType || blob.type || "audio/mp4").split(";")[0]?.trim();
  if (!type || blob.type === type) return blob;
  return new Blob([blob], { type });
}

export function canElementPlayMime(mime: string): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("audio");
  const base = mime.split(";")[0] || mime;
  return Boolean(probe.canPlayType(mime) || probe.canPlayType(base));
}
