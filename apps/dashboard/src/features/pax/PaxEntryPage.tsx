import { Link, Navigate } from "react-router-dom";
import { usePaxT } from "./i18n";
import { getStoredPaxSession } from "./session";
import "./styles/pax.css";

/**
 * Branded passenger entry (robots `/pax?full=1` treatment) — personal service only.
 */
export default function PaxEntryPage() {
  const t = usePaxT();
  if (getStoredPaxSession()?.token) {
    return <Navigate to="/pax/app" replace />;
  }

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip ok" style={{ marginBottom: 16 }}>{t("entry.chip")}</p>
        <h1 className="pax-brand">Orienta</h1>
        <p className="pax-lead">{t("entry.lead")}</p>

        <section className="pax-card">
          <h2>{t("entry.serviceTitle")}</h2>
          <p>{t("entry.serviceBody")}</p>
          <Link className="pax-btn" to="/pax/login" style={{ display: "inline-block", textDecoration: "none" }}>
            {t("entry.continue")}
          </Link>
        </section>
      </div>
    </div>
  );
}
