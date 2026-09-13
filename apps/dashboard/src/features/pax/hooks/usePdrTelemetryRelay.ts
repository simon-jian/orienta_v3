import { useEffect, useRef, type MutableRefObject } from "react";
import type { PaxRealtime } from "../../../services/realtime";
import type { PaxSession } from "../session";
import { postPaxApi } from "../assist/postPaxApi";
import { fmtAssistTime } from "../assist/assistTypes";
import { usePaxI18n } from "../i18n";

/**
 * Relays live positions from the embedded pedestrian_dead_reckoning page to the
 * backend over this app's authenticated WebSocket.
 *
 * The PDR page hands us a position roughly once per second (see that repo's
 * js/orienta-bridge.js). The WebSocket is the right transport for that rate —
 * it already carries `pax_trajectory` and its per-connection budget is 60
 * messages per 10s. HTTP is only a fallback for when the socket is down, and is
 * deliberately slow (one request per FALLBACK_INTERVAL_MS) because the pax HTTP
 * budget is shared with chat and presence.
 */
const FALLBACK_INTERVAL_MS = 5_000;
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const HEALTHY_STATUS_INTERVAL_MS = 5_000;

type LatLng = { lat: number; lng: number };
type PdrSample = { position: LatLng; path: LatLng[] };

function isLatLng(value: unknown): value is LatLng {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  return !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng);
}

function sampleFromMessage(data: unknown): PdrSample | null {
  const d = data as { position?: unknown; path?: unknown } | null;
  if (!d || !isLatLng(d.position)) return null;
  const path = Array.isArray(d.path) ? d.path.filter(isLatLng) : [];
  return { position: d.position, path: path.length ? path : [d.position] };
}

export function usePdrTelemetryRelay(opts: {
  session: PaxSession | null;
  realtimeRef: MutableRefObject<PaxRealtime | null>;
  wsUp: boolean;
  onStatus: (text: string) => void;
}): { frameRef: MutableRefObject<HTMLIFrameElement | null> } {
  const { session, realtimeRef, wsUp, onStatus } = opts;
  const { t, intlLocale } = usePaxI18n();
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const wsUpRef = useRef(wsUp);
  wsUpRef.current = wsUp;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  /** Newest sample the WebSocket could not take; only ever one (positions supersede). */
  const pendingRef = useRef<PdrSample | null>(null);
  const backoffMsRef = useRef(0);
  const nextHttpAtRef = useRef(0);
  const lastStatusAtRef = useRef(0);
  const degradedRef = useRef(false);

  // #region agent log
  const dbgSeqRef = useRef(0);
  const dbgLog = (message: string, data: Record<string, unknown>) => {
    fetch("/api/debug-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "post-fix", hypothesisId: "C",
        location: "src/features/pax/hooks/usePdrTelemetryRelay.ts",
        message, data, timestamp: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  useEffect(() => {
    if (!session) return;

    function report(text: string, force: boolean): void {
      const now = Date.now();
      if (!force && now - lastStatusAtRef.current < HEALTHY_STATUS_INTERVAL_MS) return;
      lastStatusAtRef.current = now;
      onStatusRef.current(text);
    }

    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (ev.source !== frameRef.current?.contentWindow) return;
      const type = (ev.data as { type?: unknown } | null)?.type;

      if (type === "orienta-pdr-deactivate") {
        // Drop anything still queued: flushing it after the walk ended would
        // put the passenger back on the operator's map.
        pendingRef.current = null;
        return;
      }
      if (type !== "orienta-pdr-position") return;

      const sample = sampleFromMessage(ev.data);
      if (!sample) return;

      if (wsUpRef.current && realtimeRef.current) {
        realtimeRef.current.sendTrajectory(sample.path, sample.position);
        pendingRef.current = null;
        // #region agent log
        dbgSeqRef.current += 1;
        if (dbgSeqRef.current <= 2 || dbgSeqRef.current % 10 === 0) {
          dbgLog("relayed position over websocket", {
            seq: dbgSeqRef.current, transport: "ws", pathLen: sample.path.length,
          });
        }
        // #endregion
        if (degradedRef.current) {
          degradedRef.current = false;
          report(t("nav.posRestored", { time: fmtAssistTime(Date.now(), intlLocale) }), true);
        } else {
          report(t("nav.posSynced", { time: fmtAssistTime(Date.now(), intlLocale) }), false);
        }
        return;
      }

      pendingRef.current = sample;
      if (!degradedRef.current) {
        degradedRef.current = true;
        report(t("nav.wsDown"), true);
        // #region agent log
        dbgLog("websocket down, buffering for http fallback", { wsUp: wsUpRef.current });
        // #endregion
      }
    }

    const flush = () => {
      const activeSession = sessionRef.current;
      const sample = pendingRef.current;
      if (!activeSession || !sample) return;
      if (wsUpRef.current) return;
      const now = Date.now();
      if (now < nextHttpAtRef.current) return;
      nextHttpAtRef.current = now + FALLBACK_INTERVAL_MS;

      void postPaxApi(activeSession, "/api/pax/tourist-position", {
        lat: sample.position.lat,
        lng: sample.position.lng,
        path: sample.path,
      })
        .then((res) => {
          if (res.ok) {
            pendingRef.current = null;
            backoffMsRef.current = 0;
            return;
          }
          backoffMsRef.current = backoffMsRef.current
            ? Math.min(backoffMsRef.current * 2, BACKOFF_MAX_MS)
            : BACKOFF_START_MS;
          nextHttpAtRef.current = Date.now() + backoffMsRef.current;
          report(
            res.status === 429
              ? t("nav.posRateLimited", { sec: Math.round(backoffMsRef.current / 1000) })
              : t("nav.posUploadFailed", { status: res.status }),
            true,
          );
        })
        .catch(() => {
          backoffMsRef.current = backoffMsRef.current
            ? Math.min(backoffMsRef.current * 2, BACKOFF_MAX_MS)
            : BACKOFF_START_MS;
          nextHttpAtRef.current = Date.now() + backoffMsRef.current;
        });
    };

    window.addEventListener("message", onMessage);
    const timer = window.setInterval(flush, 1_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [session, realtimeRef, t, intlLocale]);

  return { frameRef };
}
