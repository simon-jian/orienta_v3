import { useCallback, useEffect, useState } from "react";
import {
  createInvite,
  listInvites,
  resetInviteDevice,
  revokeInvite,
  type InviteLeg,
  type PaxInvite,
} from "../../services/passengers/inviteApi";

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
  const [copied, setCopied] = useState(false);

  const [passengerId, setPassengerId] = useState("");
  const [name, setName] = useState("");
  const [flightId, setFlightId] = useState("");
  const [flightDate, setFlightDate] = useState(todayLocal());
  const [leg, setLeg] = useState<InviteLeg>("outbound");

  const refresh = useCallback(async () => {
    try {
      const data = await listInvites(tenantId);
      setInvites(data.invites);
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
      setError(err instanceof Error ? err.message : "action_failed");
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    await run(async () => {
      const { url } = await createInvite({
        tenantId,
        passengerId: passengerId.trim(),
        name: name.trim() || undefined,
        flightId: flightId.trim(),
        flightDate,
        leg,
      });
      setIssuedUrl(url);
      setCopied(false);
      setPassengerId("");
      setName("");
      setFlightId("");
    });
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setCopied(true);
    } catch {
      setError("复制失败，请手动选择链接文本。");
    }
  }

  const canIssue = Boolean(passengerId.trim() && flightId.trim() && flightDate) && !busy;

  return (
    <div style={{ display: "grid", gap: 16, padding: 16, overflow: "auto" }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>签发旅客链接</div>
        <div className="small" style={{ opacity: 0.7 }}>
          按航空公司提供的旅客 UUID 与航班号签发。旅客首次打开链接的设备会被绑定，其他设备无法再使用该链接。
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
        </div>

        <div>
          <button type="button" className="btn primary" disabled={!canIssue} onClick={() => void issue()}>
            {busy ? "处理中…" : "生成链接"}
          </button>
        </div>

        {issuedUrl && (
          <div style={{ border: "1px solid #047857", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
            <div className="small" style={{ fontWeight: 700 }}>
              链接已生成 — 只显示这一次，请立即发送给旅客
            </div>
            <code style={{ wordBreak: "break-all", fontSize: 12 }}>{issuedUrl}</code>
            <div>
              <button type="button" className="btn" onClick={() => void copyUrl()}>
                {copied ? "已复制" : "复制链接"}
              </button>
            </div>
          </div>
        )}

        {error && <div className="small" style={{ color: "#c8102e" }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>已签发 ({invites.length})</div>
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
