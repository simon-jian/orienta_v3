/**
 * Outbound SMS for passenger claim links (Twilio).
 *
 * The invite secret lives in the URL fragment (`#t=`). That fragment must be
 * sent as-is — URL shorteners drop it, so this module never rewrites the URL.
 * The message body is never logged.
 */
import { claimTokenFromUrl } from "./inviteClaimUrl";
import { logger } from "./logger";

export const SMS_ERRORS = {
  not_configured: "sms_not_configured",
  missing_phone: "missing_phone",
  invalid_phone: "invalid_phone",
  invalid_url: "invalid_url",
  invite_mismatch: "invite_mismatch",
  missing_secret: "missing_secret",
  link_not_public: "link_not_public",
  send_failed: "sms_send_failed",
} as const;

export type SmsError = (typeof SMS_ERRORS)[keyof typeof SMS_ERRORS];

export type SmsConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  defaultCountryCode: string;
};

export function readSmsConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmsConfig | null {
  const accountSid = (env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (env.TWILIO_AUTH_TOKEN || "").trim();
  const fromNumber = (env.TWILIO_FROM_NUMBER || "").trim();
  if (!accountSid || !authToken || !fromNumber) return null;
  const parsedFrom = parseE164(fromNumber, "");
  if (!parsedFrom.ok) return null;
  return {
    accountSid,
    authToken,
    fromNumber: parsedFrom.e164,
    defaultCountryCode: (env.SMS_DEFAULT_COUNTRY_CODE || "").replace(/\D/g, ""),
  };
}

export function isSmsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readSmsConfig(env) !== null;
}

/**
 * Normalise operator input to E.164.
 *
 * Accepts `+14155551234`, `00`-prefixed internationals, and (when
 * `defaultCountryCode` is set) a national number such as `13800138000` with
 * `SMS_DEFAULT_COUNTRY_CODE=86`. Without a default, a bare number is rejected
 * so we never guess US vs China.
 */
export function parseE164(
  raw: unknown,
  defaultCountryCode = "",
): { ok: true; e164: string } | { ok: false; error: SmsError } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: SMS_ERRORS.missing_phone };

  let compact = trimmed.replace(/[\s\-().]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;

  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/\D/g, "");
    if (!isE164Digits(digits)) return { ok: false, error: SMS_ERRORS.invalid_phone };
    return { ok: true, e164: `+${digits}` };
  }

  const national = compact.replace(/\D/g, "");
  const cc = defaultCountryCode.replace(/\D/g, "");
  if (!cc || !/^[1-9]\d{0,3}$/.test(cc)) {
    return { ok: false, error: SMS_ERRORS.invalid_phone };
  }
  const combined = national.startsWith(cc) && national.length >= cc.length + 7
    ? national
    : `${cc}${national.replace(/^0+/, "")}`;
  if (!isE164Digits(combined)) return { ok: false, error: SMS_ERRORS.invalid_phone };
  return { ok: true, e164: `+${combined}` };
}

function isE164Digits(digits: string): boolean {
  return /^[1-9]\d{7,14}$/.test(digits);
}

/** Keep country prefix + last 4; never the full number in logs or audit rows. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 6) return "+••••";
  return `+${digits.slice(0, digits.length <= 11 ? 1 : 2)}••••${digits.slice(-4)}`;
}

export function inviteSmsBody(url: string, flightId?: string): string {
  const flight = flightId ? ` ${flightId}` : "";
  return `Orienta${flight}: open this link on this phone to start your trip\n${url}`;
}

export type ClaimUrlCheck =
  | { ok: true; url: string }
  | { ok: false; error: SmsError };

/**
 * The URL we text must be this invite's claim link on our public origin.
 * Otherwise an admin session could use our Twilio account as an open relay.
 */
export function assertInviteSmsUrl(
  raw: unknown,
  inviteId: string,
  expectedOrigin: string,
): ClaimUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false, error: SMS_ERRORS.invalid_url };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: SMS_ERRORS.invalid_url };
  }
  if (parsed.origin !== expectedOrigin) {
    return { ok: false, error: SMS_ERRORS.invite_mismatch };
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/pax/claim") return { ok: false, error: SMS_ERRORS.invite_mismatch };
  if (parsed.searchParams.get("i") !== inviteId) {
    return { ok: false, error: SMS_ERRORS.invite_mismatch };
  }
  const token = claimTokenFromUrl(parsed);
  if (!token) return { ok: false, error: SMS_ERRORS.missing_secret };

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    return { ok: false, error: SMS_ERRORS.link_not_public };
  }
  return { ok: true, url: parsed.toString() };
}

export type SendSmsResult = { ok: true } | { ok: false; error: SmsError };

const TWILIO_TIMEOUT_MS = 10_000;

export async function sendTwilioSms(
  config: SmsConfig,
  to: string,
  body: string,
  fetchFn: typeof fetch = fetch,
): Promise<SendSmsResult> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Body: body,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TWILIO_TIMEOUT_MS);
  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: ac.signal,
    });
    if (res.ok) return { ok: true };
    logger.warn("sms_send_failed", { status: res.status, to: maskPhone(to) });
    return { ok: false, error: SMS_ERRORS.send_failed };
  } catch (err) {
    logger.warn("sms_send_failed", {
      to: maskPhone(to),
      error: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false, error: SMS_ERRORS.send_failed };
  } finally {
    clearTimeout(timer);
  }
}
