import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { redeemInvite } from "./api/paxSessionApi";
import "./styles/pax.css";

/**
 * Landing page for a back-office invite link.
 *
 * The link secret arrives in the URL fragment (`#t=…`) rather than the query
 * string so it never reaches the server in a request line, referrer or access
 * log. It is read here, exchanged for a session, and then stripped from the
 * address bar so a screenshot or shared URL carries nothing usable.
 *
 * Everything the passenger needs — flight, airports, gate — comes back with
 * the session, so there is no form on this page at all.
 */

const ERROR_MESSAGES: Record<string, string> = {
  device_mismatch:
    "该链接已绑定到另一台设备。为保护你的行程信息，只有首次打开链接的设备可以使用。请联系工作人员重置绑定。",
  expired: "链接已过期，请联系工作人员重新发送。",
  revoked: "链接已失效，请联系工作人员重新发送。",
  invalid_link: "链接无效或不完整，请确认从原始短信或邮件中直接打开。",
  missing_device_id: "无法生成设备标识，请关闭无痕模式后重试。",
  rate_limit_exceeded: "尝试次数过多，请稍后再试。",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] || "领取失败，请稍后重试或联系工作人员。";
}

/** The secret lives in the fragment; the invite id stays a normal query param. */
function readTokenFromHash(): string {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get("t") || "";
}

export default function PaxClaimPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // React 18 StrictMode mounts effects twice in dev; without this the second
  // run would redeem again and inflate redeem_count on every page load.
  const startedRef = useRef(false);

  const inviteId = params.get("i") || "";

  const claim = useCallback(async () => {
    const token = readTokenFromHash();
    if (!inviteId || !token) {
      setBusy(false);
      setError(messageFor("invalid_link"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await redeemInvite(inviteId, token);
      // Drop the secret from history before leaving the page.
      window.history.replaceState(null, "", "/pax/claim");
      navigate("/pax/flight", { replace: true });
    } catch (err) {
      setError(messageFor(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  }, [inviteId, navigate]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void claim();
  }, [claim]);

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip ok" style={{ marginBottom: 16 }}>Orienta Passenger</p>
        <h1 className="pax-brand">Orienta</h1>

        {busy && (
          <section className="pax-card">
            <h2>正在打开你的行程…</h2>
            <p>正在核对链接并加载航班信息，请稍候。</p>
          </section>
        )}

        {!busy && error && (
          <section className="pax-card">
            <h2>无法打开链接</h2>
            <p>{error}</p>
            <Link className="pax-btn" to="/pax" style={{ display: "inline-block", textDecoration: "none" }}>
              返回首页
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
