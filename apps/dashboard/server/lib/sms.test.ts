import { describe, expect, it, vi } from "vitest";
import {
  SMS_ERRORS,
  assertInviteSmsUrl,
  inviteSmsBody,
  isSmsConfigured,
  maskPhone,
  parseE164,
  readSmsConfig,
  sendTwilioSms,
} from "./sms";

describe("parseE164", () => {
  it("accepts a full international number", () => {
    expect(parseE164("+1 (415) 555-1234")).toEqual({ ok: true, e164: "+14155551234" });
    expect(parseE164("008613800138000")).toEqual({ ok: true, e164: "+8613800138000" });
  });

  it("rejects a bare national number unless a default country is set", () => {
    expect(parseE164("4155551234")).toEqual({ ok: false, error: SMS_ERRORS.invalid_phone });
    expect(parseE164("4155551234", "1")).toEqual({ ok: true, e164: "+14155551234" });
    expect(parseE164("13800138000", "86")).toEqual({ ok: true, e164: "+8613800138000" });
  });

  it("does not double the country code when it is already present", () => {
    expect(parseE164("14155551234", "1")).toEqual({ ok: true, e164: "+14155551234" });
  });

  it("rejects empty and too-short values", () => {
    expect(parseE164("")).toEqual({ ok: false, error: SMS_ERRORS.missing_phone });
    expect(parseE164("+12")).toEqual({ ok: false, error: SMS_ERRORS.invalid_phone });
  });
});

describe("maskPhone", () => {
  it("keeps a prefix and the last four digits", () => {
    expect(maskPhone("+14155551234")).toBe("+1••••1234");
    expect(maskPhone("+8613800138000")).toBe("+86••••8000");
  });
});

describe("assertInviteSmsUrl", () => {
  const origin = "https://ops.example.com";
  const inviteId = "inv_abc";
  const good = `${origin}/pax/claim?i=${inviteId}#t=secret-token`;

  it("accepts this invite's claim URL on the public origin", () => {
    expect(assertInviteSmsUrl(good, inviteId, origin)).toEqual({ ok: true, url: good });
  });

  it("rejects a URL that is not our claim link", () => {
    expect(assertInviteSmsUrl("https://evil.example/phish", inviteId, origin).ok).toBe(false);
    expect(assertInviteSmsUrl(`${origin}/pax/claim?i=inv_other#t=x`, inviteId, origin)).toEqual({
      ok: false,
      error: SMS_ERRORS.invite_mismatch,
    });
  });

  it("rejects a missing fragment secret", () => {
    expect(assertInviteSmsUrl(`${origin}/pax/claim?i=${inviteId}`, inviteId, origin)).toEqual({
      ok: false,
      error: SMS_ERRORS.missing_secret,
    });
  });

  it("accepts the secret in ?t= after a client strips the fragment", () => {
    const queryOnly = `${origin}/pax/claim?i=${inviteId}&t=secret-token`;
    expect(assertInviteSmsUrl(queryOnly, inviteId, origin)).toEqual({ ok: true, url: queryOnly });
  });

  it("rejects localhost — a phone cannot open it", () => {
    expect(
      assertInviteSmsUrl(`http://localhost:5173/pax/claim?i=${inviteId}#t=x`, inviteId, "http://localhost:5173"),
    ).toEqual({ ok: false, error: SMS_ERRORS.link_not_public });
  });
});

describe("inviteSmsBody", () => {
  it("keeps the fragment on its own line so the phone opens the full link", () => {
    const url = "https://ops.example.com/pax/claim?i=inv_1#t=secret";
    expect(inviteSmsBody(url, "UA888")).toContain(url);
    expect(inviteSmsBody(url, "UA888")).toContain("UA888");
  });
});

describe("readSmsConfig / sendTwilioSms", () => {
  const env = {
    TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    TWILIO_AUTH_TOKEN: "token",
    TWILIO_FROM_NUMBER: "+14155550000",
  };

  it("is configured only when sid, token and a valid from-number are all set", () => {
    expect(isSmsConfigured(env)).toBe(true);
    expect(isSmsConfigured({ ...env, TWILIO_FROM_NUMBER: "" })).toBe(false);
    expect(readSmsConfig(env)?.fromNumber).toBe("+14155550000");
  });

  it("posts the Twilio messages API and never treats a 4xx as success", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 201 })) as unknown as typeof fetch;
    const cfg = readSmsConfig(env)!;
    await expect(sendTwilioSms(cfg, "+14155551234", "hi", fetchFn)).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/Accounts/AC");
    expect(String(init.body)).toContain("To=%2B14155551234");
    expect(String(init.body)).not.toContain(cfg.authToken);

    const fail = vi.fn(async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
    await expect(sendTwilioSms(cfg, "+14155551234", "hi", fail)).resolves.toEqual({
      ok: false,
      error: SMS_ERRORS.send_failed,
    });
  });
});
