import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  mintAccountSession,
  mintBasicSession,
  mintBoardingPassSession,
} from "./api/paxSessionApi";
import { localCalendarDate, type PaxTripIntent } from "./session";
import "./styles/pax.css";

type Mode = "boarding" | "free" | "account";

export default function PaxLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("boarding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [bcbp, setBcbp] = useState("");
  const [tripIntent, setTripIntent] = useState<PaxTripIntent>("depart");
  const [basicFlight, setBasicFlight] = useState("");
  const [basicDate, setBasicDate] = useState(localCalendarDate());
  const [basicArr, setBasicArr] = useState("");
  const [basicArrDate, setBasicArrDate] = useState(localCalendarDate());
  const [basicDep, setBasicDep] = useState("");
  const [basicDepDate, setBasicDepDate] = useState(localCalendarDate());
  const [basicName, setBasicName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountDep, setAccountDep] = useState("");
  const [accountName, setAccountName] = useState("");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      navigate("/pax/flight", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "login_failed");
    } finally {
      setBusy(false);
    }
  }

  const freeReady =
    tripIntent === "transfer"
      ? Boolean(basicArr.trim() && basicDep.trim() && basicArrDate && basicDepDate)
      : Boolean(basicFlight.trim() && basicDate);

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <Link to="/pax" className="pax-chip" style={{ textDecoration: "none", marginBottom: 16 }}>
          ← Orienta
        </Link>
        <h1 className="pax-brand">登录</h1>
        <p className="pax-lead">优先扫登机牌获取航班绑定会话；也可使用临时行程或高级账号。</p>

        <div className="pax-tabs" role="tablist">
          {(
            [
              ["boarding", "登机牌"],
              ["free", "临时"],
              ["account", "账号"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`pax-tab${mode === id ? " active" : ""}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "boarding" && (
          <section className="pax-card">
            <h2>扫登机牌 / 粘贴 BCBP</h2>
            <p>解析登机牌条码文本后创建 Premium 临时会话。无需 kiosk 密钥。</p>
            <label className="pax-field">
              <span>BCBP 文本</span>
              <textarea
                value={bcbp}
                onChange={(e) => setBcbp(e.target.value)}
                placeholder="粘贴登机牌 PDF417 / BCBP 字符串"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="pax-btn"
              disabled={busy || !bcbp.trim()}
              onClick={() => run(() => mintBoardingPassSession(bcbp.trim()))}
            >
              {busy ? "处理中…" : "领取会话"}
            </button>
          </section>
        )}

        {mode === "free" && (
          <section className="pax-card">
            <h2>临时行程（Basic）</h2>
            <p>选择行程类型。出发/抵达只需一个航班；中转需要抵达与出发两段。</p>

            <div className="pax-tabs" role="tablist" style={{ marginBottom: 14 }}>
              {(
                [
                  ["depart", "出发"],
                  ["arrive", "抵达"],
                  ["transfer", "中转"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`pax-tab${tripIntent === id ? " active" : ""}`}
                  onClick={() => setTripIntent(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tripIntent !== "transfer" ? (
              <>
                <label className="pax-field">
                  <span>航班号</span>
                  <input
                    value={basicFlight}
                    onChange={(e) => setBasicFlight(e.target.value)}
                    placeholder="UA889"
                    autoCapitalize="characters"
                  />
                </label>
                <label className="pax-field">
                  <span>{tripIntent === "arrive" ? "抵达日期" : "出发日期"}</span>
                  <input type="date" value={basicDate} onChange={(e) => setBasicDate(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <label className="pax-field">
                  <span>抵达航班</span>
                  <input value={basicArr} onChange={(e) => setBasicArr(e.target.value)} placeholder="CA836" />
                </label>
                <label className="pax-field">
                  <span>抵达日期</span>
                  <input type="date" value={basicArrDate} onChange={(e) => setBasicArrDate(e.target.value)} />
                </label>
                <label className="pax-field">
                  <span>出发航班</span>
                  <input value={basicDep} onChange={(e) => setBasicDep(e.target.value)} placeholder="CA837" />
                </label>
                <label className="pax-field">
                  <span>出发日期</span>
                  <input type="date" value={basicDepDate} onChange={(e) => setBasicDepDate(e.target.value)} />
                </label>
              </>
            )}

            <label className="pax-field">
              <span>姓名（可选）</span>
              <input value={basicName} onChange={(e) => setBasicName(e.target.value)} />
            </label>
            <button
              type="button"
              className="pax-btn"
              disabled={busy || !freeReady}
              onClick={() =>
                run(() =>
                  tripIntent === "transfer"
                    ? mintBasicSession({
                        intent: "transfer",
                        arrivalFlight: basicArr.trim(),
                        departureFlight: basicDep.trim(),
                        arrivalDate: basicArrDate,
                        departureDate: basicDepDate,
                        name: basicName.trim() || undefined,
                      })
                    : mintBasicSession({
                        intent: tripIntent,
                        flight: basicFlight.trim(),
                        date: basicDate,
                        name: basicName.trim() || undefined,
                      }),
                )
              }
            >
              {busy ? "处理中…" : "开始"}
            </button>
          </section>
        )}

        {mode === "account" && (
          <section className="pax-card">
            <h2>高级账号</h2>
            <p>邮箱与密码登录（非演示 OTP）。获得 Premium 能力含人工助手。</p>
            <label className="pax-field">
              <span>邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="pax-field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="pax-field">
              <span>出发航班</span>
              <input value={accountDep} onChange={(e) => setAccountDep(e.target.value)} placeholder="CA837" />
            </label>
            <label className="pax-field">
              <span>姓名（可选）</span>
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </label>
            <button
              type="button"
              className="pax-btn"
              disabled={busy || !email.trim() || !password || !accountDep.trim()}
              onClick={() =>
                run(() =>
                  mintAccountSession({
                    email: email.trim(),
                    password,
                    departureFlight: accountDep.trim(),
                    name: accountName.trim() || undefined,
                  }),
                )
              }
            >
              {busy ? "处理中…" : "登录"}
            </button>
          </section>
        )}

        {error ? <p className="pax-error">{error}</p> : null}
      </div>
    </div>
  );
}
