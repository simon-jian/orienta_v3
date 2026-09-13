import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchPublicArrival } from "./api/journeyApi";
import { paxErrorMessage, usePaxT } from "./i18n";
import "./styles/pax.css";

export default function ArrivalPlanPage() {
  const t = usePaxT();
  const { shareId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shareId || !token) {
      setError(paxErrorMessage(t, "missing_share_token"));
      return;
    }
    let cancelled = false;
    fetchPublicArrival(shareId, token)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(paxErrorMessage(t, err instanceof Error ? err.message : "load_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [shareId, token, t]);

  const range = data?.destinationExpectedRange as { start?: string; end?: string } | undefined;
  const remaining = data?.remainingMinutes as { min?: number; max?: number } | undefined;

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip">{t("arrival.chip")}</p>
        <h1 className="pax-brand" style={{ fontSize: "1.9rem" }}>
          {(data?.flight as string) || "—"}
        </h1>
        {error ? <p className="pax-error">{error}</p> : null}
        {!error && !data ? <p className="pax-lead">{t("common.loading")}</p> : null}
        {data ? (
          <section className="pax-card">
            <h2>{String((data.destination as { label?: string } | undefined)?.label || t("arrival.exit"))}</h2>
            <p>
              {String((data.route as { origin?: string } | undefined)?.origin || "?")} →{" "}
              {String((data.route as { destination?: string } | undefined)?.destination || "?")} ·{" "}
              {String(data.status || "")}
            </p>
            <div className="pax-chip ok">
              {t("arrival.eta", { start: range?.start || "—", end: range?.end || "—" })}
            </div>
            <div className="pax-chip" style={{ marginLeft: 8 }}>
              {t("arrival.remaining")}{" "}
              {typeof remaining?.min === "number" && typeof remaining?.max === "number"
                ? t("arrival.remainingRange", {
                    min: Math.round(remaining.min),
                    max: Math.round(remaining.max),
                  })
                : "—"}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
