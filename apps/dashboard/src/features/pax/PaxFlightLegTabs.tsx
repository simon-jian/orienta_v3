import { usePaxT } from "./i18n";
import type { PaxTripLeg } from "./session";

type Props = {
  arrivalFlight: string;
  departureFlight: string;
  activeLeg: PaxTripLeg;
  onChange: (leg: PaxTripLeg) => void;
  className?: string;
};

export function PaxFlightLegTabs({
  arrivalFlight,
  departureFlight,
  activeLeg,
  onChange,
  className = "pax-tabs",
}: Props) {
  const t = usePaxT();
  return (
    <div className={className} role="tablist" aria-label={t("flight.legsAria")}>
      <button
        type="button"
        role="tab"
        aria-selected={activeLeg === "arr"}
        className={`pax-tab${activeLeg === "arr" ? " active" : ""}`}
        onClick={() => onChange("arr")}
      >
        {t("flight.legArrivalNamed", { flight: arrivalFlight })}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeLeg === "dep"}
        className={`pax-tab${activeLeg === "dep" ? " active" : ""}`}
        onClick={() => onChange("dep")}
      >
        {t("flight.legDepartureNamed", { flight: departureFlight })}
      </button>
    </div>
  );
}
