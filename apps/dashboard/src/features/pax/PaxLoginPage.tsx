import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  mintAccountSession,
  mintBasicSession,
  mintBoardingPassSession,
} from "./api/paxSessionApi";
import { paxErrorMessage, usePaxT } from "./i18n";
import { localCalendarDate, type PaxTripIntent } from "./session";
import "./styles/pax.css";

type Mode = "boarding" | "free" | "account";

export default function PaxLoginPage() {
  const t = usePaxT();
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
      setError(paxErrorMessage(t, err instanceof Error ? err.message : "login_failed"));
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
          {t("login.back")}
        </Link>
        <h1 className="pax-brand">{t("login.title")}</h1>
        <p className="pax-lead">{t("login.lead")}</p>

        <div className="pax-tabs" role="tablist">
          {(
            [
              ["boarding", t("login.tabBoarding")],
              ["free", t("login.tabFree")],
              ["account", t("login.tabAccount")],
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
            <h2>{t("login.boardingTitle")}</h2>
            <p>{t("login.boardingBody")}</p>
            <label className="pax-field">
              <span>{t("login.bcbp")}</span>
              <textarea
                value={bcbp}
                onChange={(e) => setBcbp(e.target.value)}
                placeholder={t("login.bcbpPlaceholder")}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="pax-btn"
              disabled={busy || !bcbp.trim()}
              onClick={() => run(() => mintBoardingPassSession(bcbp.trim()))}
            >
              {busy ? t("common.processing") : t("login.claimSession")}
            </button>
          </section>
        )}

        {mode === "free" && (
          <section className="pax-card">
            <h2>{t("login.freeTitle")}</h2>
            <p>{t("login.freeBody")}</p>

            <div className="pax-tabs" role="tablist" style={{ marginBottom: 14 }}>
              {(
                [
                  ["depart", t("login.intentDepart")],
                  ["arrive", t("login.intentArrive")],
                  ["transfer", t("login.intentTransfer")],
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
                  <span>{t("login.flightNumber")}</span>
                  <input
                    value={basicFlight}
                    onChange={(e) => setBasicFlight(e.target.value)}
                    placeholder="UA889"
                    autoCapitalize="characters"
                  />
                </label>
                <label className="pax-field">
                  <span>{tripIntent === "arrive" ? t("login.arriveDate") : t("login.departDate")}</span>
                  <input type="date" value={basicDate} onChange={(e) => setBasicDate(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <label className="pax-field">
                  <span>{t("login.arrivalFlight")}</span>
                  <input value={basicArr} onChange={(e) => setBasicArr(e.target.value)} placeholder="CA836" />
                </label>
                <label className="pax-field">
                  <span>{t("login.arriveDate")}</span>
                  <input type="date" value={basicArrDate} onChange={(e) => setBasicArrDate(e.target.value)} />
                </label>
                <label className="pax-field">
                  <span>{t("login.departureFlight")}</span>
                  <input value={basicDep} onChange={(e) => setBasicDep(e.target.value)} placeholder="CA837" />
                </label>
                <label className="pax-field">
                  <span>{t("login.departDate")}</span>
                  <input type="date" value={basicDepDate} onChange={(e) => setBasicDepDate(e.target.value)} />
                </label>
              </>
            )}

            <label className="pax-field">
              <span>{t("login.nameOptional")}</span>
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
              {busy ? t("common.processing") : t("login.start")}
            </button>
          </section>
        )}

        {mode === "account" && (
          <section className="pax-card">
            <h2>{t("login.accountTitle")}</h2>
            <p>{t("login.accountBody")}</p>
            <label className="pax-field">
              <span>{t("login.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="pax-field">
              <span>{t("login.password")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="pax-field">
              <span>{t("login.departureFlight")}</span>
              <input value={accountDep} onChange={(e) => setAccountDep(e.target.value)} placeholder="CA837" />
            </label>
            <label className="pax-field">
              <span>{t("login.nameOptional")}</span>
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
              {busy ? t("common.processing") : t("login.signIn")}
            </button>
          </section>
        )}

        {error ? <p className="pax-error">{error}</p> : null}
      </div>
    </div>
  );
}
