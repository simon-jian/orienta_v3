import { useEffect, useMemo, useRef, useState } from "react";
import { INDOOR_MAP_API_BASE } from "../../../config/indoorMap";
import { NAV_AIRPORTS, findNavAirport } from "./navAirports";
import {
  applyNavPlanPrefill,
  categoryLabel,
  fetchAirportPois,
  type NavPoi,
} from "./navPoiApi";
import { paxErrorMessage, usePaxT, type PaxMessageKey } from "../i18n";
import type { NavPlanConfirmed, NavPlanHints } from "./navPlan";

type Props = {
  hints: NavPlanHints;
  onConfirm: (plan: NavPlanConfirmed) => void;
};

function groupPois(pois: NavPoi[]): Array<{ category: string; items: NavPoi[] }> {
  const map = new Map<string, NavPoi[]>();
  for (const p of pois) {
    const list = map.get(p.category) || [];
    list.push(p);
    map.set(p.category, list);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

function poiGroupLabel(category: string, t: ReturnType<typeof usePaxT>): string {
  const key = `poi.${category}` as PaxMessageKey;
  const label = t(key);
  return label === key ? categoryLabel(category) : label;
}

export function AssistNavPlanPanel({ hints, onConfirm }: Props) {
  const t = usePaxT();
  const defaultAirport =
    findNavAirport(hints.airport)?.code || NAV_AIRPORTS[0]?.code || "PEK";
  const [airportCode, setAirportCode] = useState(defaultAirport);
  const [pois, setPois] = useState<NavPoi[]>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const airportTouchedRef = useRef(false);

  const airport = useMemo(() => findNavAirport(airportCode), [airportCode]);
  const groups = useMemo(() => groupPois(pois), [pois]);

  useEffect(() => {
    if (airportTouchedRef.current) return;
    const next = findNavAirport(hints.airport)?.code;
    if (next && next !== airportCode) setAirportCode(next);
  }, [hints.airport, airportCode]);

  useEffect(() => {
    if (!airport) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setFromId("");
    setToId("");
    fetchAirportPois(INDOOR_MAP_API_BASE, airport)
      .then((list) => {
        if (cancelled) return;
        setPois(list);
        const prefill = applyNavPlanPrefill(list, hints);
        setToId(prefill.toId);
        setFromId(prefill.fromId);
      })
      .catch((err) => {
        if (!cancelled) setError(paxErrorMessage(t, err instanceof Error ? err.message : "poi_load_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [airport, hints.fromGateHint, hints.toGateHint, t]);

  const canConfirm = !!fromId && !!toId && fromId !== toId && !!airport;

  function confirm() {
    if (!airport || !canConfirm) return;
    const from = pois.find((p) => p.id === fromId);
    const to = pois.find((p) => p.id === toId);
    if (!from || !to) return;
    onConfirm({
      airport: airport.code,
      fromPoiId: from.id,
      toPoiId: to.id,
      fromLabel: from.name,
      toLabel: to.name,
      terminals: airport.terminals,
      confirmedAt: Date.now(),
    });
  }

  return (
    <section className="pax-nav-plan">
      <div className="pax-nav-plan-head">
        <h2>{t("nav.planTitle")}</h2>
        <p>
          {t("nav.planLead")}
          {hints.flightId ? t("nav.planFlightHint", { flight: hints.flightId }) : ""}
        </p>
      </div>

      <label className="pax-nav-plan-field">
        {t("nav.airport")}
        <select
          value={airportCode}
          onChange={(e) => {
            airportTouchedRef.current = true;
            setAirportCode(e.target.value);
          }}
        >
          {NAV_AIRPORTS.map((a) => (
            <option key={a.code} value={a.code}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="pax-nav-plan-field">
        {t("nav.from")}
        <select value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={loading || !pois.length}>
          <option value="">{loading ? t("nav.loadingPoi") : t("nav.selectFrom")}</option>
          {groups.map((g) => (
            <optgroup key={g.category} label={poiGroupLabel(g.category, t)}>
              {g.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.floor || p.terminal ? ` (${[p.terminal, p.floor].filter(Boolean).join(" ")})` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="pax-nav-plan-field">
        {t("nav.to")}
        <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={loading || !pois.length}>
          <option value="">{loading ? t("nav.loadingPoi") : t("nav.selectTo")}</option>
          {groups.map((g) => (
            <optgroup key={g.category} label={poiGroupLabel(g.category, t)}>
              {g.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.floor || p.terminal ? ` (${[p.terminal, p.floor].filter(Boolean).join(" ")})` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {fromId && toId && fromId === toId ? (
        <div className="pax-nav-plan-error">{t("nav.samePoint")}</div>
      ) : null}
      {error ? <div className="pax-nav-plan-error">{t("nav.poiFailed", { error })}</div> : null}
      {!loading && !error && !pois.length ? (
        <div className="pax-nav-plan-error">{t("nav.noPoi")}</div>
      ) : null}

      <button type="button" className="pax-btn pax-nav-plan-confirm" disabled={!canConfirm} onClick={confirm}>
        {t("nav.confirm")}
      </button>
    </section>
  );
}
