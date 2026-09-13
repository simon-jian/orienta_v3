import { afterEach, describe, expect, it } from "vitest";
import {
  mergeIceServers,
  parseIceServersJson,
  resetTwilioIceCache,
  resolveWebRtcIceServers,
  webrtcIceServersFromEnv,
} from "./webrtcIce";

const origSid = process.env.TWILIO_ACCOUNT_SID;
const origToken = process.env.TWILIO_AUTH_TOKEN;

afterEach(() => {
  resetTwilioIceCache();
  delete process.env.WEBRTC_ICE_SERVERS;
  if (origSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = origSid;
  if (origToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = origToken;
});

describe("parseIceServersJson", () => {
  it("accepts Twilio's url/urls shape", () => {
    const parsed = parseIceServersJson([
      { url: "stun:global.stun.twilio.com:3478", urls: "stun:global.stun.twilio.com:3478" },
      {
        urls: "turn:global.turn.twilio.com:3478?transport=udp",
        username: "u",
        credential: "c",
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ username: "u", credential: "c" });
  });
});

describe("webrtcIceServersFromEnv", () => {
  it("reads WEBRTC_ICE_SERVERS JSON", () => {
    process.env.WEBRTC_ICE_SERVERS = JSON.stringify([
      { urls: "turn:example.com:3478", username: "a", credential: "b" },
    ]);
    expect(webrtcIceServersFromEnv()[0]?.urls).toBe("turn:example.com:3478");
  });
});

describe("resolveWebRtcIceServers", () => {
  it("prefers env over Twilio", async () => {
    process.env.WEBRTC_ICE_SERVERS = JSON.stringify([{ urls: "stun:custom.example" }]);
    const servers = await resolveWebRtcIceServers({
      fetchImpl: (async () => { throw new Error("should not fetch"); }) as typeof fetch,
    });
    expect(servers).toEqual([{ urls: "stun:custom.example" }]);
  });

  it("merges Twilio TURN onto the default STUN list", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({
        ttl: 3600,
        ice_servers: [
          { urls: "turn:global.turn.twilio.com:3478", username: "u", credential: "c" },
        ],
      }),
    })) as unknown as typeof fetch;
    const servers = await resolveWebRtcIceServers({ fetchImpl, now: 1_000 });
    expect(servers.some((s) => String(s.urls).includes("stun.cloudflare.com"))).toBe(true);
    expect(servers.some((s) => String(s.urls).includes("turn:global.turn.twilio.com"))).toBe(true);
  });
});

describe("mergeIceServers", () => {
  it("dedupes by urls+username", () => {
    const merged = mergeIceServers(
      [{ urls: "stun:a" }],
      [{ urls: "stun:a" }, { urls: "turn:b", username: "u" }],
    );
    expect(merged).toHaveLength(2);
  });
});
