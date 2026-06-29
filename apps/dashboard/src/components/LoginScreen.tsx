/**
 * LoginScreen — onLogin is async; no passwords in this component.
 * Credentials are validated server-side via POST /api/auth/login.
 */
import React, { useState } from "react";

export default function LoginScreen(props: {
  onLogin(emailOrUser: string, password: string): Promise<unknown>;
}) {
  const { onLogin } = props;
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await onLogin(user, pass);
    } catch (ex: any) {
      setErr(ex?.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loginRoot">
      <div className="loginBg" />
      <div className="loginOverlay" />

      <div className="loginShell">
        <div className="loginBrand">
          <div className="loginMark">
            <div className="loginLogo" />
            <div>
              <div className="loginTitle">Orienta</div>
              <div className="loginSub">航司后台 · 北京首都机场 T3</div>
            </div>
          </div>
          <div className="loginTag">Admin Console</div>
        </div>

        <div className="loginCard">
          <div className="loginCardHeader">
            <div style={{ fontWeight: 800, fontSize: 16 }}>管理员登录</div>
            <div className="small">用于航班登机态势与旅客服务调度</div>
          </div>

          <form onSubmit={submit} className="loginForm">
            <label className="loginLabel">
              <span>账号</span>
              <input
                className="input"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="admin@airchina.com"
                autoComplete="username"
                disabled={loading}
              />
            </label>

            <label className="loginLabel">
              <span>密码</span>
              <input
                className="input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
              />
            </label>

            {err ? <div className="loginError">{err}</div> : null}

            <div className="loginActions">
              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? "登录中…" : "登录"}
              </button>
            </div>
          </form>
        </div>

        <div className="loginFoot">
          <span className="badge">🔒 Server-side JWT auth</span>
          <span className="badge">🗺 本地机场地图 / OSM fallback</span>
          <span className="badge">♿ Wheelchair / i18n Passenger Simulation</span>
        </div>
      </div>
    </div>
  );
}
