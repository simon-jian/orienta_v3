/**
 * ICE servers for passenger ↔ admin WebRTC.
 *
 * STUN alone fails when the two browsers are on different NATs (phone on
 * cellular + operator on a home/office LAN). Prefer, in order:
 *   1. WEBRTC_ICE_SERVERS JSON from the environment
 *   2. Ephemeral Twilio Network Traversal (same account as SMS)
 *   3. Public STUN only (same-LAN calls may still work)
 */
export type IceServerJson = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export const DEFAULT_STUN_SERVERS: IceServerJson[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const TWILIO_TTL_CAP_SEC = 3600;
const TWILIO_FETCH_MS = 3500;

let twilioCache: { servers: IceServerJson[]; exp: number } | null = null;

export function parseIceServersJson(raw: unknown): IceServerJson[] {
  if (!Array.isArray(raw)) return [];
  const out: IceServerJson[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const urls = rec.urls ?? rec.url;
    const normalized =
      typeof urls === "string" ? urls
        : Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string")
          : null;
    if (!normalized || (Array.isArray(normalized) && !normalized.length)) continue;
    const server: IceServerJson = { urls: normalized };
    if (typeof rec.username === "string") server.username = rec.username;
    if (typeof rec.credential === "string") server.credential = rec.credential;
    out.push(server);
  }
  return out;
}

export function webrtcIceServersFromEnv(): IceServerJson[] {
  const raw = String(process.env.WEBRTC_ICE_SERVERS || "").trim();
  if (!raw) return [];
  try {
    return parseIceServersJson(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function mergeIceServers(...lists: IceServerJson[][]): IceServerJson[] {
  const seen = new Set<string>();
  const out: IceServerJson[] = [];
  for (const list of lists) {
    for (const server of list) {
      const key = `${Array.isArray(server.urls) ? server.urls.join(",") : server.urls}|${server.username || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(server);
    }
  }
  return out;
}

export async function fetchTwilioIceServers(opts?: {
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<IceServerJson[]> {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token) return [];

  const now = opts?.now ?? Date.now();
  if (twilioCache && now < twilioCache.exp) return twilioCache.servers;

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TWILIO_FETCH_MS);
  try {
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { ice_servers?: unknown; ttl?: unknown };
    const servers = parseIceServersJson(data.ice_servers);
    if (!servers.length) return [];
    const ttlSec = Math.min(Number(data.ttl) || TWILIO_TTL_CAP_SEC, TWILIO_TTL_CAP_SEC);
    twilioCache = {
      servers,
      exp: now + Math.max(60_000, (ttlSec - 120) * 1000),
    };
    return servers;
  } catch {
    return twilioCache && now < twilioCache.exp ? twilioCache.servers : [];
  } finally {
    clearTimeout(timer);
  }
}

export function resetTwilioIceCache(): void {
  twilioCache = null;
}

export async function resolveWebRtcIceServers(opts?: {
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<IceServerJson[]> {
  const fromEnv = webrtcIceServersFromEnv();
  if (fromEnv.length) return fromEnv;
  const twilio = await fetchTwilioIceServers(opts);
  return mergeIceServers(DEFAULT_STUN_SERVERS, twilio);
}
