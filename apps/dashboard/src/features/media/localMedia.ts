import type { CallMode } from "../../types/types";

export type MediaAcquireErrorCode =
  | "insecure"
  | "unavailable"
  | "denied"
  | "notfound"
  | "inuse"
  | "failed";

export class MediaAcquireError extends Error {
  readonly code: MediaAcquireErrorCode;
  constructor(code: MediaAcquireErrorCode, message?: string) {
    super(message || code);
    this.name = "MediaAcquireError";
    this.code = code;
  }
}

export type AcquireLocalResult = {
  stream: MediaStream;
  mode: CallMode;
  cameraMissing: boolean;
};

/** getUserMedia only works on https or localhost. LAN http://192.168.x.x will not prompt. */
/** iOS keeps the camera locked if a <video> still holds the stream when tracks stop. */
export function detachCallMediaElements(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLMediaElement>(
    "video.orienta-call-remote, video.orienta-call-local, audio.orienta-call-remote-audio",
  ).forEach((el) => {
    try { el.pause(); } catch { /* ignore */ }
    el.srcObject = null;
    el.removeAttribute("src");
    try { el.load(); } catch { /* ignore */ }
  });
}

export function mediaEnvironment(): "ok" | "insecure" | "unavailable" {
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure";
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unavailable";
  return "ok";
}

export function classifyGetUserMediaError(err: unknown): MediaAcquireErrorCode {
  const name = err && typeof err === "object" && "name" in err
    ? String((err as { name: string }).name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "notfound";
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return "inuse";
  }
  return "failed";
}

export function acquireErrorCode(err: unknown): MediaAcquireErrorCode {
  if (err instanceof MediaAcquireError) return err.code;
  return classifyGetUserMediaError(err);
}

/** iPad/iPhone (and iPadOS desktop-UA) often fail `{ audio: true, video: false }` after a video call. */
export function prefersAvThenStripAudio(
  ua = typeof navigator !== "undefined" ? navigator.userAgent : "",
  maxTouchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (platform === "MacIntel" && maxTouchPoints > 1) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Android|Edg|OPR\//i.test(ua);
}

function stripVideoTracks(stream: MediaStream): MediaStream {
  for (const track of stream.getVideoTracks()) {
    try { track.stop(); } catch { /* ignore */ }
    try { stream.removeTrack(track); } catch { /* ignore */ }
  }
  return stream;
}

async function acquireAudioStream(
  gum: (c: MediaStreamConstraints) => Promise<MediaStream>,
): Promise<MediaStream> {
  try {
    return await gum({ audio: true, video: false });
  } catch (err) {
    if (isDenied(err)) throw new MediaAcquireError(classifyGetUserMediaError(err));
    // Only if the device refuses mic-only (some WebKit sessions after video).
    // Stop the camera immediately — a voice call must not keep the LED on.
    try {
      return stripVideoTracks(await gum({ audio: true, video: true }));
    } catch {
      throw new MediaAcquireError(classifyGetUserMediaError(err));
    }
  }
}

function isDenied(err: unknown): boolean {
  const code = classifyGetUserMediaError(err);
  return code === "denied" || code === "insecure";
}

/** Linux laptops often expose an IR / dummy node that getUserMedia picks first. */
export function isLikelyNonRgbCamera(label: string): boolean {
  const t = label.toLowerCase();
  return /\binfrared\b|\bir\b|dummy|virtual camera|obs virtual|v4l2loopback/.test(t);
}

export function videoTrackLooksUsable(track: MediaStreamTrack): boolean {
  if (track.readyState === "ended") return false;
  if (isLikelyNonRgbCamera(track.label || "")) return false;
  const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
  if (typeof settings.width === "number" && settings.width === 0) return false;
  if (typeof settings.height === "number" && settings.height === 0) return false;
  return true;
}

function trackWidth(track: MediaStreamTrack): number {
  const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
  return typeof settings.width === "number" ? settings.width : 0;
}

/** Some Linux UVC / PipeWire nodes stay 0×0 until a size is applied. */
export async function wakeVideoTrack(track: MediaStreamTrack): Promise<boolean> {
  if (trackWidth(track) > 0) return true;
  if (typeof track.applyConstraints !== "function") return false;
  const shapes: MediaTrackConstraints[] = [
    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { width: { ideal: 640 }, height: { ideal: 480 } },
  ];
  for (const constraints of shapes) {
    try {
      await track.applyConstraints(constraints);
      if (trackWidth(track) > 0) return true;
    } catch {
      /* try the next size */
    }
  }
  return trackWidth(track) > 0;
}

function stopExtraVideoTracks(stream: MediaStream, keep: MediaStreamTrack | null): void {
  for (const track of stream.getVideoTracks()) {
    if (keep && track.id === keep.id) continue;
    try { track.stop(); } catch { /* ignore */ }
    try { stream.removeTrack(track); } catch { /* ignore */ }
  }
}

export function takeUsableVideoTrack(stream: MediaStream): MediaStreamTrack | null {
  const tracks = stream.getVideoTracks();
  const usable = tracks.find((t) => videoTrackLooksUsable(t)) ?? null;
  stopExtraVideoTracks(stream, usable);
  return usable;
}

async function listedCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput" && d.deviceId)
      .sort((a, b) => {
        const aSkip = isLikelyNonRgbCamera(a.label) ? 1 : 0;
        const bSkip = isLikelyNonRgbCamera(b.label) ? 1 : 0;
        return aSkip - bSkip;
      });
  } catch {
    return [];
  }
}

function videoConstraints(): MediaTrackConstraints[] {
  return [
    { width: { ideal: 1280 }, height: { ideal: 720 } },
    true as unknown as MediaTrackConstraints,
    { facingMode: { ideal: "user" } },
    { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  ];
}

/**
 * Laptop Chrome often fails a combined audio+video constraint (facingMode /
 * 720p / PipeWire) and older code then kept only the mic — the webcam LED
 * never came on. Try the dumb `{ video: true }` first, then each RGB camera.
 */
export async function acquireVideoTrack(
  gum: (c: MediaStreamConstraints) => Promise<MediaStream>,
): Promise<MediaStreamTrack | null> {
  const attempts: MediaStreamConstraints[] = videoConstraints().map((video) => ({ audio: false, video }));
  const cameras = await listedCameras();
  for (const device of cameras) {
    if (isLikelyNonRgbCamera(device.label)) continue;
    attempts.push({ audio: false, video: { deviceId: { exact: device.deviceId } } });
  }
  for (const device of cameras) {
    if (!isLikelyNonRgbCamera(device.label)) continue;
    attempts.push({ audio: false, video: { deviceId: { exact: device.deviceId } } });
  }
  for (const constraints of attempts) {
    try {
      const stream = await gum(constraints);
      const track = takeUsableVideoTrack(stream);
      if (track) {
        await wakeVideoTrack(track);
        return track;
      }
      stopExtraVideoTracks(stream, null);
    } catch {
      /* try the next camera shape */
    }
  }
  return null;
}

export async function acquireLocalStream(mode: CallMode): Promise<AcquireLocalResult> {
  const env = mediaEnvironment();
  if (env !== "ok") throw new MediaAcquireError(env);

  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (mode !== "video") {
    return { stream: await acquireAudioStream(gum), mode: "audio", cameraMissing: false };
  }

  // Desktop-friendly: no facingMode / resolution. Phones still accept this.
  let audio: MediaStream | null = null;
  try {
    const stream = await gum({ audio: true, video: true });
    const video = takeUsableVideoTrack(stream);
    if (video) {
      await wakeVideoTrack(video);
      return { stream, mode: "video", cameraMissing: false };
    }
    audio = stream;
  } catch (err) {
    if (isDenied(err)) {
      // Camera may be blocked while the mic is still allowed — don't abort the call.
    }
  }

  if (!audio) {
    try {
      audio = await gum({ audio: true, video: false });
    } catch (err) {
      throw new MediaAcquireError(classifyGetUserMediaError(err));
    }
  }

  const videoTrack = await acquireVideoTrack(gum);
  if (videoTrack) {
    audio.addTrack(videoTrack);
    return { stream: audio, mode: "video", cameraMissing: false };
  }
  // Keep the call as video so the operator can retry the webcam and still
  // receive the passenger's picture.
  return { stream: audio, mode: "video", cameraMissing: true };
}
