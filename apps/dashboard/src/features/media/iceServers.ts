import { apiUrl } from "../../config/api";

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const CACHE_MS = 5 * 60_000;
let cached: { servers: RTCIceServer[]; exp: number } | null = null;
let inflight: Promise<RTCIceServer[]> | null = null;

function sanitizeIceServers(raw: unknown): RTCIceServer[] {
  if (!Array.isArray(raw)) return [];
  const out: RTCIceServer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const urls = rec.urls;
    if (typeof urls !== "string" && !Array.isArray(urls)) continue;
    const server: RTCIceServer = { urls: urls as string | string[] };
    if (typeof rec.username === "string") server.username = rec.username;
    if (typeof rec.credential === "string") server.credential = rec.credential;
    out.push(server);
  }
  return out;
}

export async function loadIceServers(): Promise<RTCIceServer[]> {
  if (cached && Date.now() < cached.exp) return cached.servers;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(apiUrl("/api/config/webrtc"));
      const data = (await res.json().catch(() => ({}))) as { iceServers?: unknown };
      const parsed = sanitizeIceServers(data.iceServers);
      const servers = parsed.length ? parsed : FALLBACK_ICE;
      cached = { servers, exp: Date.now() + CACHE_MS };
      return servers;
    } catch {
      cached = { servers: FALLBACK_ICE, exp: Date.now() + 30_000 };
      return FALLBACK_ICE;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
