import { useState } from "react";
import { savePaxSession, type PaxSession, type PaxSessionApiResult } from "./session";
import { apiUrl } from "../../config/api";

async function postPaxSession(path: string, body: Record<string, unknown>): Promise<PaxSession> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as PaxSessionApiResult;
  if (!res.ok || !data.ok || !data.session) {
    throw new Error(data.error || "session_failed");
  }
  savePaxSession(data.session);
  return data.session;
}

function Field(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ fontWeight: 700 }}>{props.label}</span>
      <input
        className="input"
        type={props.type || "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export default function PaxEntryPage() {
  const [basicArr, setBasicArr] = useState("");
  const [basicDep, setBasicDep] = useState("");
  const [basicName, setBasicName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountDep, setAccountDep] = useState("");
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<PaxSession | null>(null);

  async function submit(kind: string, run: () => Promise<PaxSession>) {
    setBusy(kind);
    setError("");
    try {
      setSession(await run());
    } catch (err) {
      setError(err instanceof Error ? err.message : "session_failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", padding: 24, boxSizing: "border-box" }}>
      <main style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header className="card">
          <div className="small">Orienta Passenger</div>
          <h1 style={{ margin: "6px 0 8px", fontSize: 28 }}>旅客服务入口</h1>
          <p style={{ margin: 0, color: "#636366" }}>
            请选择进入方式。系统会先创建后端旅客会话，再开放导航、通知、位置共享和对应等级的通信能力。
          </p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>登机牌扫描（Kiosk）</h2>
            <p className="small">
              Premium 临时会话仅由机场 kiosk / 受信任终端创建：调用{" "}
              <code>POST /api/pax/scan</code> 并携带 <code>X-Kiosk-Secret</code>。
              浏览器页面故意不提供扫码入口，避免把 kiosk 密钥放进前端。
            </p>
            <p className="small" style={{ color: "#636366", margin: 0 }}>
              Boarding-pass mint is kiosk-only (shared secret header). Use Basic
              transfer or Premium account login below in the browser.
            </p>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>手动中转</h2>
            <p className="small">临时 Basic。可导航、接收通知、共享位置，但不能自由联系 operator。</p>
            <Field label="抵达航班" value={basicArr} onChange={setBasicArr} placeholder="CA836" />
            <Field label="出发航班" value={basicDep} onChange={setBasicDep} placeholder="CA837" />
            <Field label="姓名（可选）" value={basicName} onChange={setBasicName} />
            <button
              className="btn primary"
              disabled={busy === "basic"}
              onClick={() => submit("basic", () => postPaxSession("/api/pax/basic-session", {
                arrivalFlight: basicArr,
                departureFlight: basicDep,
                name: basicName,
              }))}
            >
              创建 Basic 临时会话
            </button>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Premium 账号登录</h2>
            <p className="small">付费账号登录。使用运营侧发放的邮箱与密码。</p>
            <Field label="Email" value={accountEmail} onChange={setAccountEmail} placeholder="premium@orienta.ai" />
            <Field label="Password" value={accountPassword} onChange={setAccountPassword} type="password" />
            <Field label="出发航班" value={accountDep} onChange={setAccountDep} placeholder="CA837" />
            <Field label="姓名（可选）" value={accountName} onChange={setAccountName} />
            <button
              className="btn primary"
              disabled={busy === "account"}
              onClick={() => submit("account", () => postPaxSession("/api/pax/account-login", {
                email: accountEmail,
                password: accountPassword,
                departureFlight: accountDep,
                name: accountName,
              }))}
            >
              登录 Premium 账号
            </button>
          </div>
        </section>

        {error ? <div className="card" style={{ color: "#ff3b30" }}>Error: {error}</div> : null}

        {session ? (
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>会话已创建</h2>
            <div className="small">
              {session.passenger.name} ({session.passenger.id}) · {session.accountType} · {session.plan}
            </div>
            <div className="small">Capabilities: {session.capabilities.join(", ")}</div>
            <a className="btn primary" style={{ textAlign: "center", textDecoration: "none" }} href="/pax/app">
              进入新版旅客端
            </a>
          </section>
        ) : null}
      </main>
    </div>
  );
}
