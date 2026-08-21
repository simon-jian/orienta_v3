/**
 * Outbound email for passenger claim links (SMTP).
 *
 * The claim secret is in `?t=` (Outlook and QR scanners drop `#t=`). The
 * visible body still repeats the full URL. A PNG QR of that same URL is
 * attached inline (cid).
 */
import nodemailer from "nodemailer";
import { INVITE_QR_CID, INVITE_QR_FILENAME, tryRenderInviteQr, type InviteQr } from "./inviteQr";
import { logger } from "./logger";
import { assertInviteSmsUrl } from "./sms";

export const MAIL_ERRORS = {
  not_configured: "email_not_configured",
  missing_email: "missing_email",
  invalid_email: "invalid_email",
  send_failed: "email_send_failed",
  auth_failed: "email_auth_failed",
  from_rejected: "email_from_rejected",
} as const;

export type MailError = (typeof MAIL_ERRORS)[keyof typeof MAIL_ERRORS];

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;

export function parseEmail(raw: unknown): { ok: true; email: string } | { ok: false; error: MailError } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: MAIL_ERRORS.missing_email };
  if (trimmed.length > MAX_EMAIL_LEN) return { ok: false, error: MAIL_ERRORS.invalid_email };
  const email = trimmed.toLowerCase();
  if (!EMAIL_RE.test(email) || email.includes("..")) {
    return { ok: false, error: MAIL_ERRORS.invalid_email };
  }
  return { ok: true, email };
}

/** Address inside `Name <addr@host>` or a bare address. */
export function extractMailAddress(from: string): string {
  const angle = from.indexOf("<");
  if (angle >= 0) return from.slice(angle + 1, from.indexOf(">", angle)).trim();
  return from.trim();
}

/** First character of the local part + domain; never the full address in logs. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "••••";
  return `${email[0]}••••@${email.slice(at + 1)}`;
}

export function readMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const host = (env.SMTP_HOST || "").trim();
  const user = (env.SMTP_USER || "").trim();
  const pass = (env.SMTP_PASS || "").trim();
  const fromRaw = (env.MAIL_FROM || "").trim() || user;
  if (!host || !user || !pass || !fromRaw) return null;

  const fromAddr = extractMailAddress(fromRaw);
  if (!parseEmail(fromAddr).ok) return null;

  const port = Number.parseInt(env.SMTP_PORT || "587", 10);
  const secure = env.SMTP_SECURE === "1" || port === 465;
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user,
    pass,
    from: fromRaw,
  };
}

export function isMailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readMailConfig(env) !== null;
}

/**
 * Gmail (and most shared SMTP) will refuse a From that is not the
 * authenticated user, unless that address is a verified send-as alias.
 */
export function mailFromMismatch(config: MailConfig): boolean {
  const from = parseEmail(extractMailAddress(config.from));
  const user = parseEmail(config.user);
  return !from.ok || !user.ok || from.email !== user.email;
}

export function inviteEmailSubject(flightId?: string): string {
  return flightId ? `Orienta 行程链接 — ${flightId}` : "Orienta 行程链接";
}

export function inviteEmailText(url: string, opts?: { name?: string; flightId?: string }): string {
  const hello = opts?.name ? `${opts.name}，您好。\n\n` : "您好。\n\n";
  const flight = opts?.flightId ? `（航班 ${opts.flightId}）` : "";
  return (
    `${hello}请用这台手机打开下面的链接开始行程${flight}。` +
    `链接只会绑定第一台打开的设备，请不要转发给他人。\n\n` +
    `${url}\n\n` +
    `也可以扫描邮件里的二维码打开。如果按钮打不开，请复制整段链接（必须包含 # 后面的部分）。链接 48 小时内有效。`
  );
}

export function inviteEmailHtml(url: string, opts?: { name?: string; flightId?: string; qrCid?: string }): string {
  const safeUrl = escapeAttr(url);
  const safeVisible = escapeHtml(url);
  const name = opts?.name ? escapeHtml(opts.name) : "";
  const flight = opts?.flightId ? escapeHtml(opts.flightId) : "";
  const hello = name ? `${name}，您好。` : "您好。";
  const flightLine = flight ? `（航班 ${flight}）` : "";
  const qrBlock = opts?.qrCid
    ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;">也可以用手机扫描二维码打开：</p>
    <p style="margin:0 0 20px;">
      <img src="cid:${escapeAttr(opts.qrCid)}" width="196" height="196" alt="行程二维码" style="display:block;width:196px;height:196px;border:0;" />
    </p>`
    : "";
  return `<!doctype html>
<html lang="zh">
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px 24px 20px;border:1px solid #e5e7eb;">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.04em;color:#047857;font-weight:700;">ORIENTA</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${hello}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
      请用<strong>这台手机</strong>打开链接开始行程${flightLine}。链接只会绑定第一台打开的设备，请不要转发给他人。
    </p>
    <p style="margin:0 0 20px;">
      <a href="${safeUrl}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;">打开行程</a>
    </p>
    ${qrBlock}
    <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#4b5563;">
      如果按钮无法打开，请复制整段链接（必须包含 <code>#</code> 后面的部分）：
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;">${safeVisible}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">链接 48 小时内有效。</p>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export type MailAttachment = {
  filename: string;
  content: Buffer;
  cid: string;
  contentType: string;
  contentDisposition?: "inline" | "attachment";
};

export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
};

export type MailTransportResult = { ok: true } | { ok: false; code?: string };
export type MailTransport = (message: MailMessage) => Promise<MailTransportResult>;

function classifySmtpFailure(code: string | undefined): MailError {
  const c = (code || "").toUpperCase();
  if (c === "EAUTH" || c === "EAUTHENTICATION") return MAIL_ERRORS.auth_failed;
  if (c === "EENVELOPE" || c === "EMESSAGE" || c === "ESENDER") return MAIL_ERRORS.from_rejected;
  return MAIL_ERRORS.send_failed;
}

export function createSmtpTransport(config: MailConfig): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  return async (message) => {
    try {
      await transporter.sendMail(message);
      return { ok: true };
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code || "") : "";
      const responseCode =
        err && typeof err === "object" && "responseCode" in err
          ? Number((err as { responseCode?: unknown }).responseCode)
          : undefined;
      logger.warn("email_send_failed", {
        to: maskEmail(message.to),
        code: code || (err instanceof Error ? err.name : "unknown"),
        responseCode: Number.isFinite(responseCode) ? responseCode : undefined,
      });
      return { ok: false, code };
    }
  };
}

export async function sendInviteMail(
  input: {
    to: unknown;
    url: string;
    inviteId: string;
    expectedOrigin: string;
    name?: string;
    flightId?: string;
  },
  deps?: { config?: MailConfig | null; transport?: MailTransport; qr?: InviteQr | null },
): Promise<{ ok: true; to: string } | { ok: false; error: string; status: number }> {
  const config = deps?.config !== undefined ? deps.config : readMailConfig();
  if (!config) return { ok: false, error: MAIL_ERRORS.not_configured, status: 503 };

  const parsed = parseEmail(input.to);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const claim = assertInviteSmsUrl(input.url, input.inviteId, input.expectedOrigin);
  if (!claim.ok) return { ok: false, error: claim.error, status: 400 };

  const qr = deps?.qr !== undefined ? deps.qr : await tryRenderInviteQr(claim.url);
  const message: MailMessage = {
    from: config.from,
    to: parsed.email,
    subject: inviteEmailSubject(input.flightId),
    text: inviteEmailText(claim.url, { name: input.name, flightId: input.flightId }),
    html: inviteEmailHtml(claim.url, {
      name: input.name,
      flightId: input.flightId,
      qrCid: qr ? INVITE_QR_CID : undefined,
    }),
    attachments: qr
      ? [
          {
            filename: INVITE_QR_FILENAME,
            content: qr.png,
            cid: INVITE_QR_CID,
            contentType: "image/png",
            contentDisposition: "inline",
          },
        ]
      : undefined,
  };
  const transport = deps?.transport ?? createSmtpTransport(config);
  const sent = await transport(message);
  if (!sent.ok) {
    const error = classifySmtpFailure(sent.code);
    return { ok: false, error, status: 502 };
  }
  return { ok: true, to: maskEmail(parsed.email) };
}
