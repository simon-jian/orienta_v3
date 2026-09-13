import { useEffect, useMemo, useState } from "react";
import { fetchClosestFlight, fetchTransfer } from "../api/flightApi";
import { localCalendarDate, type PaxSession } from "../session";
import { baseInfoStrip, flightLabel, resolveAssistTrip } from "../assist/assistTrip";
import type { AssistInfoStrip } from "../assist/assistTypes";
import { usePaxT } from "../i18n";

/** Hold "connected" through brief WS flaps (common on trycloudflare / mobile Safari). */
const OFFLINE_GRACE_MS = 8_000;

export function useAssistInfoStrip(
  session: PaxSession | null,
  rtUp: boolean,
  /** True when HTTP presence heartbeat recently succeeded (tunnel-friendly). */
  presenceOk = false,
): AssistInfoStrip {
  const t = usePaxT();
  const trip = useMemo(() => (session ? resolveAssistTrip(session) : null), [session]);
  const [enrichment, setEnrichment] = useState<{
    inboundLabel?: string;
    outboundLabel?: string;
  }>({});
  const [linkUp, setLinkUp] = useState(false);

  useEffect(() => {
    const live = rtUp || presenceOk;
    if (live) {
      setLinkUp(true);
      return;
    }
    const t = window.setTimeout(() => setLinkUp(false), OFFLINE_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [rtUp, presenceOk]);

  useEffect(() => {
    if (!session || !trip) return;
    let cancelled = false;

    (async () => {
      try {
        if (trip.intent === "transfer") {
          const arr = trip.arrivalFlight || "";
          const dep = trip.departureFlight || session.passenger.flightId;
          if (!arr || !dep) return;
          const data = await fetchTransfer(arr, dep);
          if (cancelled) return;
          setEnrichment({
            inboundLabel: flightLabel(
              data.arrival.flight_iata || arr,
              data.arrival.arr_iata || data.hub_airport,
              data.arrival.arr_gate || data.from_gate,
            ),
            outboundLabel: flightLabel(
              data.departure.flight_iata || dep,
              data.departure.dep_iata || data.hub_airport,
              data.departure.dep_gate || data.to_gate,
            ),
          });
          return;
        }

        const flight = trip.flight || session.passenger.flightId;
        const date = trip.date || localCalendarDate();
        const data = await fetchClosestFlight(flight, date, trip.intent);
        if (cancelled) return;
        const inst = data.instance;
        if (trip.intent === "arrive") {
          setEnrichment({
            inboundLabel: flightLabel(inst.flight_iata || flight, inst.arr_iata, inst.arr_gate),
            outboundLabel: "—",
          });
        } else {
          setEnrichment({
            inboundLabel: "—",
            outboundLabel: flightLabel(
              inst.flight_iata || flight,
              inst.dep_iata,
              inst.dep_gate || session.passenger.gateId,
            ),
          });
        }
      } catch {
        if (!cancelled) setEnrichment({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, trip]);

  return useMemo(() => {
    if (!session || !trip) {
      return { inbound: "—", outbound: "—", gate: "—", status: "—" };
    }
    const status = !linkUp ? t("strip.offline") : session.plan === "free" ? t("strip.assisted") : t("strip.connected");
    return baseInfoStrip(session, trip, { ...enrichment, status });
  }, [session, trip, enrichment, linkUp, t]);
}
