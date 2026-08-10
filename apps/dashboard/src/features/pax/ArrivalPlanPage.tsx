import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchPublicArrival } from "./api/journeyApi";
import "./styles/pax.css";

export default function ArrivalPlanPage() {
  const { shareId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shareId || !token) {
      setError("missing_share_token");
      return;
    }
    let cancelled = false;
    fetchPublicArrival(shareId, token)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [shareId, token]);

  const range = data?.destinationExpectedRange as { start?: string; end?: string } | undefined;
  const remaining = data?.remainingMinutes as { min?: number; max?: number } | undefined;

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip">Arrival plan</p>
        <h1 className="pax-brand" style={{ fontSize: "1.9rem" }}>
          {(data?.flight as string) || "—"}
        </h1>
        {error ? <p className="pax-error">{error}</p> : null}
        {!error && !data ? <p className="pax-lead">Loading…</p> : null}
        {data ? (
          <section className="pax-card">
            <h2>{String((data.destination as { label?: string } | undefined)?.label || "Exit")}</h2>
            <p>
              {String((data.route as { origin?: string } | undefined)?.origin || "?")} →{" "}
              {String((data.route as { destination?: string } | undefined)?.destination || "?")} ·{" "}
              {String(data.status || "")}
            </p>
            <div className="pax-chip ok">
              ETA {range?.start || "—"} – {range?.end || "—"}
            </div>
            <div className="pax-chip" style={{ marginLeft: 8 }}>
              Remaining{" "}
              {typeof remaining?.min === "number" && typeof remaining?.max === "number"
                ? `${Math.round(remaining.min)}–${Math.round(remaining.max)} min`
                : "—"}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
