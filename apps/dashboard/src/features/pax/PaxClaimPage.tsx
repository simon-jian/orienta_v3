import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { redeemInvite } from "./api/paxSessionApi";
import { readClaimToken } from "./claimToken";
import { paxErrorMessage, usePaxT } from "./i18n";
import "./styles/pax.css";

/**
 * Landing page for a back-office invite link.
 *
 * The link secret is in `?t=` (and, for older links, `#t=`). Mail clients and
 * QR scanners drop the fragment; the query form is what actually opens. After
 * redeem we strip both from the address bar.
 *
 * Everything the passenger needs — flight, airports, gate — comes back with
 * the session, so there is no form on this page at all.
 */

export default function PaxClaimPage() {
  const t = usePaxT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // React 18 StrictMode mounts effects twice in dev; without this the second
  // run would redeem again and inflate redeem_count on every page load.
  const startedRef = useRef(false);

  const inviteId = params.get("i") || "";

  const claim = useCallback(async () => {
    const token = readClaimToken(window.location.search, window.location.hash);
    if (!inviteId || !token) {
      setBusy(false);
      setError(paxErrorMessage(t, "invalid_link"));
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
      setError(paxErrorMessage(t, err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  }, [inviteId, navigate, t]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void claim();
  }, [claim]);

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip ok" style={{ marginBottom: 16 }}>{t("claim.chip")}</p>
        <h1 className="pax-brand">Orienta</h1>

        {busy && (
          <section className="pax-card">
            <h2>{t("claim.openingTitle")}</h2>
            <p>{t("claim.openingBody")}</p>
          </section>
        )}

        {!busy && error && (
          <section className="pax-card">
            <h2>{t("claim.errorTitle")}</h2>
            <p>{error}</p>
            <Link className="pax-btn" to="/pax" style={{ display: "inline-block", textDecoration: "none" }}>
              {t("claim.backHome")}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
