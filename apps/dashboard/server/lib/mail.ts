/**
 * Outbound email for passenger claim links (SMTP).
 *
 * The claim secret is in `?t=` (Outlook and QR scanners drop `#t=`). The
 * visible body still repeats the full URL. A PNG QR of that same URL is
 * attached inline (cid).
 */
import nodemailer from "nodemailer";
import { INVITE_LOGO_CID, INVITE_LOGO_FILENAME, tryLoadInviteLogo } from "./inviteLogo";
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

/** Display name in the From header; SMTP still uses the configured address. */
export const INVITE_MAIL_FROM_NAME = "中国国际航空 · Orienta";

export function brandedInviteFrom(from: string): string {
  const addr = extractMailAddress(from);
  return `${INVITE_MAIL_FROM_NAME} <${addr}>`;
}

export function inviteEmailSubject(flightId?: string): string {
  return flightId
    ? `${INVITE_MAIL_FROM_NAME} — 您的行程服务（${flightId}）`
    : `${INVITE_MAIL_FROM_NAME} — 您的行程服务`;
}

export function inviteEmailText(url: string, opts?: { name?: string; flightId?: string }): string {
  const who = opts?.name ? `尊敬的 ${opts.name} 旅客：\n\n` : "尊敬的旅客：\n\n";
  const flight = opts?.flightId ? `航班 ${opts.flightId} ` : "";
  return (
    `${who}您好！感谢您选择中国国际航空。\n\n` +
    `为方便您本次出行，我们为您开通了${flight}的行程服务。` +
    `请使用您本人的手机打开下方链接或扫描邮件中的二维码。` +
    `该链接仅可在第一台设备上激活，请勿转发他人。\n\n` +
    `${url}\n\n` +
    `如链接无法打开，请复制完整地址（须包含 # 后面的部分）。本链接 48 小时内有效。\n\n` +
    `祝您旅途愉快。\n中国国际航空\n\nPowered by Orienta`
  );
}

export function inviteEmailHtml(url: string, opts?: { name?: string; flightId?: string; qrCid?: string; logoCid?: string }): string {
  const safeUrl = escapeAttr(url);
  const safeVisible = escapeHtml(url);
  const name = opts?.name ? escapeHtml(opts.name) : "";
  const flight = opts?.flightId ? escapeHtml(opts.flightId) : "";
  const greeting = name ? `尊敬的 ${name} 旅客：` : "尊敬的旅客：";
  const flightLine = flight ? `航班 <strong>${flight}</strong> ` : "";
  const qrBlock = opts?.qrCid
    ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#333333;">您也可以使用手机扫描下方二维码打开：</p>
              <p style="margin:0 0 22px;">
                <img src="cid:${escapeAttr(opts.qrCid)}" width="196" height="196" alt="行程二维码" style="display:block;width:196px;height:196px;border:0;" />
              </p>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#f3f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #eeeeee;">
          <tr><td style="height:4px;background:#E60012;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td style="padding:22px 28px 8px;font-family:Arial,Helvetica,'Microsoft YaHei','PingFang SC',sans-serif;">
              ${opts?.logoCid
                ? `<img src="cid:${escapeAttr(opts.logoCid)}" width="132" height="88" alt="中国国际航空" style="display:block;width:132px;height:88px;border:0;" />
              <div style="margin-top:10px;font-size:13px;letter-spacing:0.12em;color:#333333;">中国国际航空 · Orienta</div>`
                : `<div style="font-size:20px;font-weight:800;letter-spacing:0.06em;color:#111111;">AIR CHINA</div>
              <div style="margin-top:4px;font-size:13px;letter-spacing:0.14em;color:#333333;">中国国际航空 · Orienta</div>`}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif;color:#222222;">
              <p style="margin:16px 0 8px;font-size:16px;line-height:1.6;">${greeting}</p>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.75;">您好！感谢您选择中国国际航空。</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.75;">
                为方便您本次出行，我们为您开通了${flightLine}的行程服务。请使用<strong>您本人的手机</strong>打开下方链接。该链接仅可在第一台设备上激活，请勿转发他人。
              </p>
              <p style="margin:0 0 22px;">
                <a href="${safeUrl}" style="display:inline-block;background:#E60012;color:#ffffff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:700;font-size:15px;">查看我的行程</a>
              </p>
              ${qrBlock}
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#666666;">
                如按钮无法打开，请复制完整链接（须包含 <span style="font-family:Consolas,monospace;">#</span> 后面的部分）：
              </p>
              <p style="margin:0 0 16px;font-size:13px;line-height:1.6;word-break:break-all;color:#333333;">${safeVisible}</p>
              <p style="margin:0 0 20px;font-size:13px;color:#888888;">本链接 48 小时内有效。祝您旅途愉快。</p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#333333;">中国国际航空</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#fafafa;border-top:3px solid #E60012;text-align:center;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:13px;font-weight:800;letter-spacing:0.12em;color:#E60012;">POWERED BY ORIENTA</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
  deps?: { config?: MailConfig | null; transport?: MailTransport; qr?: InviteQr | null; logo?: Buffer | null },
): Promise<{ ok: true; to: string } | { ok: false; error: string; status: number }> {
  const config = deps?.config !== undefined ? deps.config : readMailConfig();
  if (!config) return { ok: false, error: MAIL_ERRORS.not_configured, status: 503 };

  const parsed = parseEmail(input.to);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const claim = assertInviteSmsUrl(input.url, input.inviteId, input.expectedOrigin);
  if (!claim.ok) return { ok: false, error: claim.error, status: 400 };

  const qr = deps?.qr !== undefined ? deps.qr : await tryRenderInviteQr(claim.url);
  const logo = deps?.logo !== undefined ? deps.logo : tryLoadInviteLogo();
  const attachments: MailAttachment[] = [];
  if (logo) {
    attachments.push({
      filename: INVITE_LOGO_FILENAME,
      content: logo,
      cid: INVITE_LOGO_CID,
      contentType: "image/png",
      contentDisposition: "inline",
    });
  }
  if (qr) {
    attachments.push({
      filename: INVITE_QR_FILENAME,
      content: qr.png,
      cid: INVITE_QR_CID,
      contentType: "image/png",
      contentDisposition: "inline",
    });
  }
  const message: MailMessage = {
    from: brandedInviteFrom(config.from),
    to: parsed.email,
    subject: inviteEmailSubject(input.flightId),
    text: inviteEmailText(claim.url, { name: input.name, flightId: input.flightId }),
    html: inviteEmailHtml(claim.url, {
      name: input.name,
      flightId: input.flightId,
      qrCid: qr ? INVITE_QR_CID : undefined,
      logoCid: logo ? INVITE_LOGO_CID : undefined,
    }),
    attachments: attachments.length ? attachments : undefined,
  };
  const transport = deps?.transport ?? createSmtpTransport(config);
  const sent = await transport(message);
  if (!sent.ok) {
    const error = classifySmtpFailure(sent.code);
    return { ok: false, error, status: 502 };
  }
  return { ok: true, to: maskEmail(parsed.email) };
}
