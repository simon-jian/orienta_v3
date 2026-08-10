import { useCallback, useEffect, useState } from "react";
import {
  getTimeToExit,
  getTimeToGate,
  patchJourneyPreferences,
  type JourneyPreferences,
} from "../api/journeyApi";
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

function rangeText(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const r = value as { min?: number; max?: number; start?: string; end?: string };
  if (typeof r.start === "string" && typeof r.end === "string") return `${r.start} – ${r.end}`;
  if (typeof r.min === "number" && typeof r.max === "number") {
    return `${Math.round(r.min)}–${Math.round(r.max)} min`;
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
      setError(err instanceof Error ? err.message : "journey_failed");
    } finally {
      setBusy(false);
    }
  }, [open, session.token, gateFlight, gateDate, exitFlight, exitDate, bags, security, destination, immigration]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!open) return null;

  const isGate = open === "gate";
  const data = isGate ? gateData : exitData;
  const headline = isGate
    ? rangeText(data?.terminalEntryRange) !== "—"
      ? rangeText(data?.terminalEntryRange)
      : rangeText(data?.range ?? data?.totalRange)
    : rangeText(data?.destinationExpectedRange) !== "—"
      ? rangeText(data?.destinationExpectedRange)
      : rangeText(data?.range ?? data?.remainingMinutes);

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
            <h2 id="pax-sheet-title">{isGate ? "Time to Gate" : "Time to Exit"}</h2>
            <p>{isGate ? gateSubtitle : exitSubtitle}</p>
          </div>
          <button type="button" className="pax-sheet__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="pax-sheet__hero">{busy ? "…" : headline}</div>
        <div className="pax-sheet__rows">
          {isGate ? (
            <>
              <div>
                <span>Target gate arrival</span>
                <b>{String(data?.targetGateArrivalLocal || data?.targetGateArrival || "—")}</b>
              </div>
              <div>
                <span>Estimated airport processing</span>
                <b>{rangeText(data?.range ?? data?.totalRange)}</b>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>Airport exit time</span>
                <b>{rangeText(data?.range ?? data?.remainingMinutes)}</b>
              </div>
              <div>
                <span>Destination</span>
                <b>{String(data?.destinationLabel || "Exit")}</b>
              </div>
            </>
          )}
        </div>

        <Seg
          label="Checked bags"
          value={bags}
          options={[
            { id: "no", label: "No" },
            { id: "yes", label: "Yes" },
            { id: "unknown", label: "Not sure" },
          ]}
          onChange={setBags}
        />
        {isGate ? (
          <Seg
            label="Security method"
            value={security}
            options={[
              { id: "standard", label: "Standard" },
              { id: "priority", label: "Priority" },
              { id: "trusted", label: "Pre✓" },
            ]}
            onChange={setSecurity}
          />
        ) : (
          <>
            <Seg
              label="Destination"
              value={destination}
              options={[
                { id: "unknown", label: "Exit" },
                { id: "curbside", label: "Pickup" },
                { id: "rideshare", label: "Rideshare" },
                { id: "parking", label: "Parking" },
                { id: "transit", label: "Transit" },
              ]}
              onChange={setDestination}
            />
            <Seg
              label="Immigration"
              value={immigration}
              options={[
                { id: "not-required", label: "Not required" },
                { id: "visitor", label: "Required" },
                { id: "unknown", label: "Not sure" },
              ]}
              onChange={setImmigration}
            />
          </>
        )}

        <button type="button" className="pax-btn secondary" style={{ width: "100%", marginTop: 10 }} onClick={() => void refresh()} disabled={busy}>
          {busy ? "Updating…" : "Update estimate"}
        </button>

        <button type="button" className="pax-link" onClick={() => setShowBasis((v) => !v)}>
          {showBasis ? "▾ Hide calculation basis" : "▸ View calculation basis"}
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
