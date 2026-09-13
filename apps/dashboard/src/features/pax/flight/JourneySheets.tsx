import { useCallback, useEffect, useState } from "react";
import {
  getTimeToExit,
  getTimeToGate,
  patchJourneyPreferences,
  type JourneyPreferences,
} from "../api/journeyApi";
import { paxErrorMessage, usePaxT, type PaxTranslate } from "../i18n";
import { ArrivalShareControls } from "./ArrivalShareControls";
import type { PaxSession } from "../session";

type SheetKind = "gate" | "exit" | null;

type Props = {
  session: PaxSession;
  open: SheetKind;
  onClose: () => void;
  gateFlight: string;
  exitFlight: string;
  gateDate: string;
  exitDate: string;
  gateSubtitle: string;
  exitSubtitle: string;
};

function rangeText(value: unknown, t: PaxTranslate): string {
  if (!value || typeof value !== "object") return "—";
  const r = value as { min?: number; max?: number; start?: string; end?: string };
  if (typeof r.start === "string" && typeof r.end === "string") return `${r.start} – ${r.end}`;
  if (typeof r.min === "number" && typeof r.max === "number") {
    return t("common.rangeMin", { min: Math.round(r.min), max: Math.round(r.max) });
  }
  return "—";
}

function Seg(props: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="pax-seg">
      <div className="pax-seg__label">{props.label}</div>
      <div className="pax-seg__row">
        {props.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`pax-seg__btn${props.value === opt.id ? " is-active" : ""}`}
            onClick={() => props.onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function JourneySheets({
  session,
  open,
  onClose,
  gateFlight,
  exitFlight,
  gateDate,
  exitDate,
  gateSubtitle,
  exitSubtitle,
}: Props) {
  const t = usePaxT();
  const [gateData, setGateData] = useState<Record<string, unknown> | null>(null);
  const [exitData, setExitData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bags, setBags] = useState("unknown");
  const [security, setSecurity] = useState("trusted");
  const [destination, setDestination] = useState("unknown");
  const [immigration, setImmigration] = useState("unknown");
  const [showBasis, setShowBasis] = useState(false);

  const refresh = useCallback(async () => {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      if (open === "gate") {
        const patch: Partial<JourneyPreferences> = {
          checkedBags: bags as JourneyPreferences["checkedBags"],
          securityLane: security,
        };
        await patchJourneyPreferences(session.token, gateFlight, gateDate, patch).catch(() => null);
        setGateData(await getTimeToGate(session.token, gateFlight, gateDate));
      } else {
        const patch: Partial<JourneyPreferences> = {
          checkedBags: bags as JourneyPreferences["checkedBags"],
          destination,
          immigration,
        };
        await patchJourneyPreferences(session.token, exitFlight, exitDate, patch).catch(() => null);
        setExitData(await getTimeToExit(session.token, exitFlight, exitDate));
      }
    } catch (err) {
      setError(paxErrorMessage(t, err instanceof Error ? err.message : "journey_failed"));
    } finally {
      setBusy(false);
    }
  }, [open, session.token, gateFlight, gateDate, exitFlight, exitDate, bags, security, destination, immigration, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!open) return null;

  const isGate = open === "gate";
  const data = isGate ? gateData : exitData;
  const headline = isGate
    ? rangeText(data?.terminalEntryRange, t) !== "—"
      ? rangeText(data?.terminalEntryRange, t)
      : rangeText(data?.range ?? data?.totalRange, t)
    : rangeText(data?.destinationExpectedRange, t) !== "—"
      ? rangeText(data?.destinationExpectedRange, t)
      : rangeText(data?.range ?? data?.remainingMinutes, t);

  return (
    <div className="pax-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pax-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pax-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pax-sheet__head">
          <div>
            <h2 id="pax-sheet-title">{isGate ? t("flight.timeToGate") : t("flight.timeToExit")}</h2>
            <p>{isGate ? gateSubtitle : exitSubtitle}</p>
          </div>
          <button type="button" className="pax-sheet__close" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <div className="pax-sheet__hero">{busy ? "…" : headline}</div>
        <div className="pax-sheet__rows">
          {isGate ? (
            <>
              <div>
                <span>{t("sheet.targetGate")}</span>
                <b>{String(data?.targetGateArrivalLocal || data?.targetGateArrival || "—")}</b>
              </div>
              <div>
                <span>{t("sheet.airportProcessing")}</span>
                <b>{rangeText(data?.range ?? data?.totalRange, t)}</b>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>{t("sheet.airportExitTime")}</span>
                <b>{rangeText(data?.range ?? data?.remainingMinutes, t)}</b>
              </div>
              <div>
                <span>{t("sheet.destination")}</span>
                <b>{String(data?.destinationLabel || t("arrival.exit"))}</b>
              </div>
            </>
          )}
        </div>

        <Seg
          label={t("sheet.checkedBags")}
          value={bags}
          options={[
            { id: "no", label: t("sheet.bagsNo") },
            { id: "yes", label: t("sheet.bagsYes") },
            { id: "unknown", label: t("sheet.bagsUnknown") },
          ]}
          onChange={setBags}
        />
        {isGate ? (
          <Seg
            label={t("sheet.security")}
            value={security}
            options={[
              { id: "standard", label: t("sheet.secStandard") },
              { id: "priority", label: t("sheet.secPriority") },
              { id: "trusted", label: t("sheet.secTrusted") },
            ]}
            onChange={setSecurity}
          />
        ) : (
          <>
            <Seg
              label={t("sheet.destination")}
              value={destination}
              options={[
                { id: "unknown", label: t("sheet.destExit") },
                { id: "curbside", label: t("sheet.destPickup") },
                { id: "rideshare", label: t("sheet.destRideshare") },
                { id: "parking", label: t("sheet.destParking") },
                { id: "transit", label: t("sheet.destTransit") },
              ]}
              onChange={setDestination}
            />
            <Seg
              label={t("sheet.immigration")}
              value={immigration}
              options={[
                { id: "not-required", label: t("sheet.immNotRequired") },
                { id: "visitor", label: t("sheet.immRequired") },
                { id: "unknown", label: t("sheet.immUnknown") },
              ]}
              onChange={setImmigration}
            />
          </>
        )}

        <button type="button" className="pax-btn secondary" style={{ width: "100%", marginTop: 10 }} onClick={() => void refresh()} disabled={busy}>
          {busy ? t("sheet.updating") : t("sheet.updateEstimate")}
        </button>

        <button type="button" className="pax-link" onClick={() => setShowBasis((v) => !v)}>
          {showBasis ? t("sheet.hideBasis") : t("sheet.viewBasis")}
        </button>
        {showBasis ? (
          <pre className="pax-basis">{JSON.stringify(data?.breakdown || data?.assumptions || data || {}, null, 2)}</pre>
        ) : null}

        {!isGate ? (
          <div style={{ marginTop: 14 }}>
            <ArrivalShareControls
              session={session}
              flightOverride={exitFlight}
              dateOverride={exitDate}
            />
          </div>
        ) : null}

        {error ? <p className="pax-error">{error}</p> : null}
      </div>
    </div>
  );
}
