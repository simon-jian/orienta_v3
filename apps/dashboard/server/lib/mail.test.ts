import { describe, expect, it, vi } from "vitest";
import { INVITE_LOGO_CID } from "./inviteLogo";
import { INVITE_QR_CID } from "./inviteQr";
import {
  MAIL_ERRORS,
  brandedInviteFrom,
  extractMailAddress,
  inviteEmailHtml,
  inviteEmailSubject,
  inviteEmailText,
  isMailConfigured,
  mailFromMismatch,
  maskEmail,
  parseEmail,
  readMailConfig,
  sendInviteMail,
  type MailMessage,
} from "./mail";

const env = {
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "ops@example.com",
  SMTP_PASS: "secret",
  MAIL_FROM: "Orienta <ops@example.com>",
};

describe("parseEmail / maskEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(parseEmail("  Siyao.Fu@United.com ")).toEqual({ ok: true, email: "siyao.fu@united.com" });
    expect(parseEmail("")).toEqual({ ok: false, error: MAIL_ERRORS.missing_email });
    expect(parseEmail("not-an-email")).toEqual({ ok: false, error: MAIL_ERRORS.invalid_email });
  });

  it("keeps the domain and the first local character", () => {
    expect(maskEmail("siyao.fu@united.com")).toBe("s••••@united.com");
  });
});

describe("readMailConfig", () => {
  it("needs host, user, pass and a valid from address", () => {
    expect(isMailConfigured(env)).toBe(true);
    expect(readMailConfig(env)?.from).toBe("Orienta <ops@example.com>");
    expect(isMailConfigured({ ...env, MAIL_FROM: "not-an-email" })).toBe(false);
    expect(isMailConfigured({ ...env, SMTP_PASS: "" })).toBe(false);
  });

  it("treats port 465 as implicit TLS", () => {
    expect(readMailConfig({ ...env, SMTP_PORT: "465" })?.secure).toBe(true);
    expect(readMailConfig({ ...env, SMTP_PORT: "587" })?.secure).toBe(false);
  });

  it("falls back MAIL_FROM to SMTP_USER when unset", () => {
    const cfg = readMailConfig({ ...env, MAIL_FROM: "" });
    expect(cfg?.from).toBe("ops@example.com");
  });

  it("flags a From that is not the SMTP user", () => {
    const cfg = readMailConfig(env)!;
    expect(mailFromMismatch(cfg)).toBe(false);
    expect(mailFromMismatch({ ...cfg, from: "Orienta <other@example.com>" })).toBe(true);
    expect(extractMailAddress("Orienta <ops@example.com>")).toBe("ops@example.com");
    expect(brandedInviteFrom("Orienta <ops@example.com>")).toBe("中国国际航空 · Orienta <ops@example.com>");
    expect(brandedInviteFrom("ops@example.com")).toBe("中国国际航空 · Orienta <ops@example.com>");
  });
});

describe("invite email body", () => {
  const url = "https://ops.example.com/pax/claim?i=inv_1#t=secret";

  it("puts the full URL (including #t=) in both text and HTML", () => {
    expect(inviteEmailSubject("UA888")).toContain("UA888");
    expect(inviteEmailSubject("UA888")).toContain("中国国际航空 · Orienta");
    expect(inviteEmailSubject("UA888")).toContain("行程服务");
    expect(inviteEmailText(url, { name: "Siyao", flightId: "UA888" })).toContain(url);
    expect(inviteEmailText(url, { name: "Siyao", flightId: "UA888" })).toContain("UA888");
    expect(inviteEmailText(url, { name: "Siyao", flightId: "UA888" })).toContain("Powered by Orienta");
    expect(inviteEmailHtml(url, { name: "Siyao", flightId: "UA888" })).toContain(url);
    expect(inviteEmailHtml(url)).toContain(`href="${url}"`);
    expect(inviteEmailHtml(url)).toContain("#t=secret");
    expect(inviteEmailHtml(url, { logoCid: INVITE_LOGO_CID })).toContain(`src="cid:${INVITE_LOGO_CID}"`);
    expect(inviteEmailHtml(url)).toContain("中国国际航空 · Orienta");
    expect(inviteEmailHtml(url)).toContain("POWERED BY ORIENTA");
    expect(inviteEmailHtml(url)).toContain("#E60012");
    expect(inviteEmailText(url)).toContain("二维码");
  });

  it("embeds the QR as a cid image when one is supplied", () => {
    const html = inviteEmailHtml(url, { qrCid: INVITE_QR_CID });
    expect(html).toContain(`src="cid:${INVITE_QR_CID}"`);
    expect(html).toContain(url);
  });
});

describe("sendInviteMail", () => {
  const origin = "https://ops.example.com";
  const inviteId = "inv_abc";
  const url = `${origin}/pax/claim?i=${inviteId}#t=secret-token`;
  const config = readMailConfig(env)!;

  it("sends through the transport and masks the recipient", async () => {
    let captured: MailMessage | undefined;
    const transport = async (message: MailMessage) => {
      captured = message;
      return { ok: true as const };
    };
    await expect(
      sendInviteMail(
        { to: "Siyao.Fu@united.com", url, inviteId, expectedOrigin: origin, flightId: "UA888" },
        { config, transport },
      ),
    ).resolves.toEqual({ ok: true, to: "s••••@united.com" });
    expect(captured?.to).toBe("siyao.fu@united.com");
    expect(captured?.text).toContain("#t=secret-token");
    expect(captured?.from).toBe("中国国际航空 · Orienta <ops@example.com>");
    expect(captured?.html).toContain(`src="cid:${INVITE_QR_CID}"`);
    expect(captured?.html).toContain(`src="cid:${INVITE_LOGO_CID}"`);
    expect(captured?.attachments?.map((a) => a.cid)).toEqual([INVITE_LOGO_CID, INVITE_QR_CID]);
    expect(captured?.attachments?.every((a) => a.contentType === "image/png")).toBe(true);
    const qr = captured?.attachments?.find((a) => a.cid === INVITE_QR_CID);
    expect(qr?.content.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  it("refuses a localhost claim URL", async () => {
    const transport = vi.fn(async () => ({ ok: true as const }));
    await expect(
      sendInviteMail(
        {
          to: "a@b.com",
          url: `http://localhost:5173/pax/claim?i=${inviteId}#t=x`,
          inviteId,
          expectedOrigin: "http://localhost:5173",
        },
        { config, transport },
      ),
    ).resolves.toEqual({ ok: false, error: "link_not_public", status: 400 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns not_configured when SMTP is missing", async () => {
    await expect(
      sendInviteMail({ to: "a@b.com", url, inviteId, expectedOrigin: origin }, { config: null }),
    ).resolves.toEqual({ ok: false, error: MAIL_ERRORS.not_configured, status: 503 });
  });

  it("maps SMTP auth failure to email_auth_failed", async () => {
    const transport = async () => ({ ok: false as const, code: "EAUTH" });
    await expect(
      sendInviteMail({ to: "a@b.com", url, inviteId, expectedOrigin: origin }, { config, transport }),
    ).resolves.toEqual({ ok: false, error: MAIL_ERRORS.auth_failed, status: 502 });
  });
});
