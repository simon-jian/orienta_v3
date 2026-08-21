import { useCallback, useEffect, useState } from "react";
import {
  createInvite,
  eraseInactiveInvites,
  eraseInvite,
  listInvites,
  resetInviteDevice,
  revokeInvite,
  sendInviteEmail,
  sendInviteSms,
  type InviteLeg,
  type PaxInvite,
} from "../../services/passengers/inviteApi";

const ACTION_ERROR_TEXT: Record<string, string> = {
  request_failed_404:
    "删除接口还没加载。后台 5175 仍是旧进程（重启时常见 EADDRINUSE）。先停掉占用 5175 的旧 Node，再执行 npm run dev:server。",
  invite_not_found: "这条邀请已经不在了，刷新列表即可。",
};

const DELIVERY_ERROR_TEXT: Record<string, string> = {
  sms_not_configured: "未配置短信网关。在 .env 中设置 TWILIO_ACCOUNT_SID、TWILIO_AUTH_TOKEN、TWILIO_FROM_NUMBER。",
  email_not_configured: "未配置邮件。在 .env 中设置 SMTP_HOST、SMTP_USER、SMTP_PASS。MAIL_FROM 可省略，默认等于 SMTP_USER。",
  email_auth_failed: "SMTP 登录失败。Hotmail / Outlook 个人邮箱已不支持用户名密码发信（应用密码也不行），请改用 Gmail 的 16 位应用专用密码。",
  email_from_rejected: "发件人被拒。MAIL_FROM 必须与 SMTP_USER 相同，或该地址已在发件服务里验证为别名。",
  email_send_failed: "邮件发送失败，请稍后重试或改为复制链接。",
  request_failed_502: "邮件服务器拒绝了这次发送。Hotmail / Outlook 个人邮箱请改用 Gmail。",
  missing_phone: "请填写手机号。",
  missing_email: "请填写邮箱。",
  invalid_phone: "手机号无效。请使用国际格式，例如 +14155551234 或 +8613800138000。",
  invalid_email: "邮箱格式无效。",
  invalid_url: "链接无效，请重新生成后再发。",
  invite_mismatch: "链接与这条邀请不匹配，请重新生成。",
  missing_secret: "链接缺少密钥，请重新生成后再发。",
  link_not_public: "链接还是本机地址，对方打不开。请设置 PUBLIC_BASE_URL 为公网域名后重新生成。",
  invite_inactive: "这条邀请已撤销或过期，请重新签发。",
  sms_send_failed: "短信网关发送失败，请稍后重试或改为复制链接。",
};

function deliveryErrorText(code: string): string {
  return DELIVERY_ERROR_TEXT[code] || code;
}

/**
 * Issue and manage device-bound passenger links.
 *
 * The generated URL is shown once, right after creation, because the server
 * keeps only a hash of its secret. Reissuing is the recovery path, not lookup.
 */

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : "—";
}

function bindingLabel(invite: PaxInvite): { text: string; color: string } {
  if (!invite.isActive) return { text: "已撤销", color: "#6b7280" };
  if (Date.now() >= invite.expiresAt) return { text: "已过期", color: "#6b7280" };
  if (invite.deviceBound) return { text: "已绑定设备", color: "#047857" };
  return { text: "等待首次打开", color: "#b45309" };
}

/**
 * What the passenger is holding, e.g. "iPhone · iOS 17.5 · Safari". Web Push on
 * iOS needs 16.4+ and a home-screen install, so an out-of-date iPhone is worth
 * flagging when a passenger reports missing notifications.
 */
function deviceLabel(invite: PaxInvite): string {
  const d = invite.device;
  if (!d || (!d.os && !d.browser)) return invite.deviceBound ? "设备信息未知" : "";
  const os = [d.os, d.osVersion].filter(Boolean).join(" ");
  const kind = d.isMobile ? "手机" : "非手机";
  return [os, d.browser, kind].filter(Boolean).join(" · ");
}

function route(invite: PaxInvite): string {
  const { depIata, arrIata } = invite.flight;
  if (!depIata && !arrIata) return "航班信息待刷新";
  return `${depIata || "?"} → ${arrIata || "?"}`;
}

function gateLabel(invite: PaxInvite): string {
  const gate = invite.leg === "inbound" ? invite.flight.arrGate : invite.flight.depGate;
  const terminal = invite.leg === "inbound" ? invite.flight.arrTerminal : invite.flight.depTerminal;
  if (!gate && !terminal) return "登机口待公布";
  return [terminal && `T${terminal}`, gate].filter(Boolean).join(" · ");
}

export default function InvitesPanel({ tenantId }: { tenantId: string }) {
  const [invites, setInvites] = useState<PaxInvite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState("");
  const [issuedQr, setIssuedQr] = useState("");
  const [issuedInviteId, setIssuedInviteId] = useState("");
  const [copied, setCopied] = useState(false);
  const [smsConfigured, setSmsConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailFromWarning, setEmailFromWarning] = useState(false);
  const [publicOrigin, setPublicOrigin] = useState("");
  const [smsBusy, setSmsBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [smsTo, setSmsTo] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [smsError, setSmsError] = useState("");
  const [emailError, setEmailError] = useState("");

  const [passengerId, setPassengerId] = useState("");
  const [name, setName] = useState("");
  const [flightId, setFlightId] = useState("");
  const [flightDate, setFlightDate] = useState(todayLocal());
  const [leg, setLeg] = useState<InviteLeg>("outbound");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await listInvites(tenantId);
      setInvites(data.invites);
      setSmsConfigured(Boolean(data.smsConfigured));
      setEmailConfigured(Boolean(data.emailConfigured));
      setEmailFromWarning(Boolean(data.emailFromWarning));
      if (data.publicOrigin) setPublicOrigin(data.publicOrigin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : "action_failed";
      setError(ACTION_ERROR_TEXT[code] || DELIVERY_ERROR_TEXT[code] || code);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    await run(async () => {
      setSmsTo("");
      setEmailTo("");
      setSmsError("");
      setEmailError("");
      const { invite, url, qrDataUrl, publicOrigin: origin, smsConfigured: smsOn, emailConfigured: mailOn, emailFromWarning: fromWarn, sms, email: mail } = await createInvite({
        tenantId,
        passengerId: passengerId.trim(),
        name: name.trim() || undefined,
        flightId: flightId.trim(),
        flightDate,
        leg,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      setIssuedUrl(url);
      setIssuedQr(qrDataUrl || "");
      setIssuedInviteId(invite.inviteId);
      setCopied(false);
      setSmsConfigured(smsOn);
      setEmailConfigured(mailOn);
      setEmailFromWarning(Boolean(fromWarn));
      if (origin) setPublicOrigin(origin);
      setSmsTo(sms?.sent ? sms.to || "" : "");
      setSmsError(sms && !sms.sent ? deliveryErrorText(sms.error || "") : "");
      setEmailTo(mail?.sent ? mail.to || "" : "");
      setEmailError(mail && !mail.sent ? deliveryErrorText(mail.error || "") : "");
      setPassengerId("");
      setName("");
      setFlightId("");
    });
  }

  async function textIssuedLink() {
    if (!issuedInviteId || !issuedUrl || !phone.trim()) {
      setSmsError(deliveryErrorText("missing_phone"));
      return;
    }
    setSmsBusy(true);
    setSmsError("");
    try {
      const { to } = await sendInviteSms({ inviteId: issuedInviteId, phone: phone.trim(), url: issuedUrl });
      setSmsTo(to);
    } catch (err) {
      setSmsError(deliveryErrorText(err instanceof Error ? err.message : "sms_send_failed"));
    } finally {
      setSmsBusy(false);
    }
  }

  async function emailIssuedLink() {
    if (!issuedInviteId || !issuedUrl || !email.trim()) {
      setEmailError(deliveryErrorText("missing_email"));
      return;
    }
    setEmailBusy(true);
    setEmailError("");
    try {
      const { to } = await sendInviteEmail({ inviteId: issuedInviteId, email: email.trim(), url: issuedUrl });
      setEmailTo(to);
    } catch (err) {
      setEmailError(deliveryErrorText(err instanceof Error ? err.message : "email_send_failed"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setCopied(true);
    } catch {
      setError("复制失败，请手动选择链接文本。");
    }
  }

  function downloadQr() {
    if (!issuedQr) return;
    const a = document.createElement("a");
    a.href = issuedQr;
    a.download = "orienta-trip-qr.png";
    a.click();
  }

  const canIssue = Boolean(passengerId.trim() && flightId.trim() && flightDate) && !busy;

  return (
    <div style={{ display: "grid", gap: 16, padding: 16, overflow: "auto" }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>签发旅客链接</div>
        <div className="small" style={{ opacity: 0.7 }}>
          按航空公司提供的旅客 UUID 与航班号签发。旅客首次打开链接的设备会被绑定，其他设备无法再使用该链接。填写邮箱后，生成时会同时发出中文行程邮件（含链接和二维码）；也可生成后再发。刷新页面后密钥不再保存，只能重新签发。
        </div>
        <div className="small" style={{ opacity: 0.75 }}>
          邮件：{emailConfigured ? "已配置 SMTP" : "未配置（仍可复制链接）"}
          {emailConfigured && emailFromWarning
            ? " · 发件人与 SMTP_USER 不一致，Gmail 很可能会拒信。把 MAIL_FROM 改成与 SMTP_USER 相同的地址，或在 Gmail 验证该别名。"
            : ""}
          {" · "}
          短信：{smsConfigured ? "已配置 Twilio" : "未配置"}
        </div>
        <div className="small" style={{ opacity: 0.75 }}>
          链接和二维码指向你当前打开的后台：{typeof window !== "undefined" ? window.location.origin.replace(/^https?:\/\//, "") : publicOrigin.replace(/^https?:\/\//, "")}
          {typeof window !== "undefined" && window.location.hostname === "localhost"
            ? "（localhost 只有这台电脑打得开。局域网请用 192.168.x.x:5173 打开后再签发；外网请用 trycloudflare 打开后再签发。）"
            : ""}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 4, flex: "1 1 220px" }}>
            <span className="small">旅客 UUID</span>
            <input value={passengerId} onChange={(e) => setPassengerId(e.target.value)} placeholder="航司提供的唯一标识" />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 160px" }}>
            <span className="small">姓名</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Siyao Fu" />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "0 1 140px" }}>
            <span className="small">航班号</span>
            <input value={flightId} onChange={(e) => setFlightId(e.target.value)} placeholder="UA888" />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "0 1 160px" }}>
            <span className="small">航班日期</span>
            <input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "0 1 130px" }}>
            <span className="small">行程段</span>
            <select value={leg} onChange={(e) => setLeg(e.target.value === "inbound" ? "inbound" : "outbound")}>
              <option value="outbound">出港</option>
              <option value="inbound">进港</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
            <span className="small">手机号（短信，可选）</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+14155551234 或 +86138…"
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 220px" }}>
            <span className="small">邮箱（可选）</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="passenger@airline.com"
              autoComplete="email"
            />
          </label>
        </div>

        <div>
          <button type="button" className="btn primary" disabled={!canIssue} onClick={() => void issue()}>
            {busy ? "处理中…" : "生成链接与二维码"}
          </button>
        </div>

        {issuedUrl && (
          <div style={{ border: "1px solid #047857", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
            <div className="small" style={{ fontWeight: 700 }}>
              链接与二维码已生成 — 只显示这一次，请立即发送给旅客
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              {issuedQr && (
                <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                  <img
                    src={issuedQr}
                    width={168}
                    height={168}
                    alt="行程二维码"
                    style={{ width: 168, height: 168, background: "#fff", borderRadius: 8 }}
                  />
                  <button type="button" className="btn" onClick={downloadQr}>
                    下载二维码
                  </button>
                </div>
              )}
              <div style={{ flex: "1 1 220px", display: "grid", gap: 8, minWidth: 0 }}>
                <code style={{ wordBreak: "break-all", fontSize: 12 }}>{issuedUrl}</code>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => void copyUrl()}>
                    {copied ? "已复制" : "复制链接"}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={smsBusy || !phone.trim()}
                    title={!smsConfigured ? "未配置 Twilio 时发送会失败，仍可先复制链接" : "把完整链接发到上面的手机号"}
                    onClick={() => void textIssuedLink()}
                  >
                    {smsBusy ? "发送中…" : smsTo ? "再次发送短信" : "发送短信"}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={emailBusy || !email.trim()}
                    title={!emailConfigured ? "未配置 SMTP 时发送会失败，仍可先复制链接" : "把完整链接和二维码发到上面的邮箱"}
                    onClick={() => void emailIssuedLink()}
                  >
                    {emailBusy ? "发送中…" : emailTo ? "再次发送邮件" : "发送邮件"}
                  </button>
                </div>
              </div>
            </div>
            {smsTo && (
              <div className="small" style={{ color: "#047857" }}>
                短信已发送至 {smsTo}
              </div>
            )}
            {emailTo && (
              <div className="small" style={{ color: "#047857" }}>
                邮件（含二维码）已发送至 {emailTo}
              </div>
            )}
            {smsError && <div className="small" style={{ color: "#c8102e" }}>{smsError}</div>}
            {emailError && <div className="small" style={{ color: "#c8102e" }}>{emailError}</div>}
            {!smsConfigured && !emailConfigured && (
              <div className="small" style={{ opacity: 0.7 }}>
                短信/邮件均未配置：可复制链接手动发送。邮件需 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM。
              </div>
            )}
            {smsConfigured && !emailConfigured && (
              <div className="small" style={{ opacity: 0.7 }}>
                邮件未配置。设置 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM 后即可一键发送。
              </div>
            )}
            {!smsConfigured && emailConfigured && (
              <div className="small" style={{ opacity: 0.7 }}>
                短信未配置。设置 TWILIO_* 后即可发短信。
              </div>
            )}
          </div>
        )}

        {error && <div className="small" style={{ color: "#c8102e" }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>已签发 ({invites.length})</div>
          {invites.some((invite) => !invite.isActive || Date.now() >= invite.expiresAt) && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("清除所有已过期和已撤销的邀请？没有其他邀请的旅客 ID 也会从名单删除。")) return;
                void run(() => eraseInactiveInvites(tenantId));
              }}
            >
              清除已失效
            </button>
          )}
        </div>
        {invites.length === 0 && <div className="small" style={{ opacity: 0.65 }}>暂无记录。</div>}

        {invites.map((invite) => {
          const status = bindingLabel(invite);
          return (
            <div
              key={invite.inviteId}
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 6,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b>
                  {invite.passengerName || "未命名"} <span style={{ fontWeight: 500, opacity: 0.6 }}>({invite.passengerId})</span>
                </b>
                <span className="small" style={{ fontWeight: 700, color: status.color }}>{status.text}</span>
              </div>
              <div className="small">
                {invite.flightId} · {invite.flightDate} · {invite.leg === "inbound" ? "进港" : "出港"} · {route(invite)}
              </div>
              <div className="small" style={{ opacity: 0.75 }}>
                {gateLabel(invite)} · 打开 {invite.redeemCount} 次 · 最近 {formatTime(invite.lastSeenAt)}
              </div>
              {deviceLabel(invite) && (
                <div className="small" style={{ opacity: 0.75 }}>
                  设备：{deviceLabel(invite)}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !invite.deviceBound}
                  title={invite.deviceBound ? "允许旅客换一台设备重新打开" : "尚未绑定设备"}
                  onClick={() => void run(() => resetInviteDevice(invite.inviteId))}
                >
                  重置设备绑定
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !invite.isActive}
                  onClick={() => void run(() => revokeInvite(invite.inviteId))}
                >
                  撤销
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const label = invite.passengerName || invite.passengerId;
                    if (!window.confirm(`删除 ${label}（${invite.passengerId}）？邀请会从列表去掉；若没有其他邀请，旅客记录也会删除。`)) return;
                    void run(() => eraseInvite(invite.inviteId));
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
