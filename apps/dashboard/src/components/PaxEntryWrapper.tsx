import { useEffect, useMemo, useRef, useState } from "react";

(function initPaxShellNavDebugGlobals() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!Array.isArray(g.__ORIENTA_NAV_PATH_STEPS__)) g.__ORIENTA_NAV_PATH_STEPS__ = [];
  if (!Array.isArray(g.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__)) g.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = [];
})();

function qs(name: string) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
}

function appendRouteSiteParams(dest: URL) {
  const rs = (qs("routeSite") || "").trim();
  const rm = (qs("routeMap") || "").trim();
  if (rs) dest.searchParams.set("routeSite", rs);
  else if (rm) dest.searchParams.set("routeMap", rm);
}

function appendRouteSiteIndoorParams(dest: URL) {
  const iu = (qs("indoorMapUrl") || qs("orientaIndoorMapUrl") || "").trim();
  const ia = (qs("indoorMapApi") || "").trim();
  const it = (qs("indoorTileBase") || "").trim();
  const itu = (qs("indoorTileUrl") || "").trim();
  if (iu) dest.searchParams.set("indoorMapUrl", iu);
  if (ia) dest.searchParams.set("indoorMapApi", ia);
  if (it) dest.searchParams.set("indoorTileBase", it);
  if (itu) dest.searchParams.set("indoorTileUrl", itu);
}

function appendOrientaDebugParams(dest: URL) {
  const d = (qs("orientaDebug") || qs("debug") || "").trim();
  if (/^(1|true|yes)$/i.test(d)) dest.searchParams.set("orientaDebug", "1");
  const npl = (qs("orientaNavPathLog") || qs("navPathLog") || "").trim();
  if (/^(1|true|yes)$/i.test(npl)) dest.searchParams.set("orientaNavPathLog", "1");
}

function appendOrientaMapPosLogParams(dest: URL) {
  for (const name of ["orientaMapPosLog", "orientaTouristDebug", "touristPosLog"] as const) {
    const v = (qs(name) || "").trim();
    if (/^(1|true|yes)$/i.test(v)) dest.searchParams.set(name, "1");
  }
}

function appendPdrParams(dest: URL) {
  const pdrOriginLat = (qs("pdrOriginLat") || qs("pdrLat") || "").trim();
  const pdrOriginLng = (qs("pdrOriginLng") || qs("pdrLng") || "").trim();
  if (pdrOriginLat && pdrOriginLng) {
    dest.searchParams.set("pdrOriginLat", pdrOriginLat);
    dest.searchParams.set("pdrOriginLng", pdrOriginLng);
  }
  const pdrOnMap = (qs("pdrOnMap") || qs("pdrMap") || "").trim();
  if (pdrOnMap) dest.searchParams.set("pdrOnMap", pdrOnMap);
  const pdrMapMatch = (qs("pdrMapMatch") || "").trim();
  if (pdrMapMatch) dest.searchParams.set("pdrMapMatch", pdrMapMatch);
  const pdrBackend = (qs("pdrBackend") || "").trim();
  if (pdrBackend) dest.searchParams.set("pdrBackend", pdrBackend);
}

function normalizePlan(raw: string | null): "free" | "premium" {
  const p = (raw || "").trim().toLowerCase();
  return p === "premium" || p === "paid" ? "premium" : "free";
}

function buildPaxHtmlSrc(origin: string, tenantId: string, pid: string) {
  const u = new URL("/pax.html", origin);
  u.searchParams.set("tenant", tenantId);
  u.searchParams.set("pax", pid);
  u.searchParams.set("plan", normalizePlan(qs("plan")));
  const name = (qs("name") || "").trim();
  if (name) u.searchParams.set("name", name);
  u.searchParams.set("hub", (qs("hub") || "PEK").trim());
  const gf = (qs("gateFrom") || "").trim();
  const gt = (qs("gateTo") || "").trim();
  if (gf) u.searchParams.set("gateFrom", gf);
  if (gt) u.searchParams.set("gateTo", gt);
  const dep = (qs("dep") || "").trim();
  const arr = (qs("arr") || "").trim();
  if (dep) u.searchParams.set("dep", dep);
  if (arr) u.searchParams.set("arr", arr);
  appendRouteSiteParams(u);
  appendRouteSiteIndoorParams(u);
  appendOrientaDebugParams(u);
  appendOrientaMapPosLogParams(u);
  return u.pathname + "?" + u.searchParams.toString();
}

type EntryPayload = {
  mode?: "free" | "paid";
  type?: string;
  flight?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  message?: string;
  [k: string]: any;
};

function buildPaxFlightSrc(
  origin: string,
  tenantId: string,
  pid: string,
  plan: "free" | "premium",
  name: string,
  intent: "depart" | "arrive" | "transfer",
  payload: { flight?: string; arr?: string; dep?: string },
) {
  const f = new URL("/pax-flight.html", origin);
  f.searchParams.set("tenant", tenantId);
  f.searchParams.set("pid", pid);
  f.searchParams.set("plan", plan);
  f.searchParams.set("name", name);
  f.searchParams.set("intent", intent);
  if (payload.flight) f.searchParams.set("flight", payload.flight);
  if (payload.arr)    f.searchParams.set("arr", payload.arr);
  if (payload.dep)    f.searchParams.set("dep", payload.dep);
  appendOrientaDebugParams(f);
  return f.pathname + "?" + f.searchParams.toString();
}

function buildPaxDialogVideoSrc(origin: string, tenantId: string, pid: string) {
  const u = new URL("/pax.html", origin);
  u.searchParams.set("tenant", tenantId);
  u.searchParams.set("pax", pid);
  u.searchParams.set("plan", normalizePlan(qs("plan")));
  const name = (qs("name") || "").trim();
  if (name) u.searchParams.set("name", name);
  u.searchParams.set("hub", (qs("hub") || "PEK").trim());
  u.searchParams.set("view", "video");
  const gateFrom = (qs("gateFrom") || "").trim();
  const gateTo = (qs("gateTo") || "").trim();
  if (gateFrom) u.searchParams.set("gateFrom", gateFrom);
  if (gateTo) u.searchParams.set("gateTo", gateTo);
  const dep = (qs("dep") || "").trim();
  const arr = (qs("arr") || "").trim();
  if (dep) u.searchParams.set("dep", dep);
  if (arr) u.searchParams.set("arr", arr);
  const autoGate = (qs("autoGate") || "").trim();
  if (autoGate === "1") u.searchParams.set("autoGate", "1");
  appendRouteSiteParams(u);
  appendRouteSiteIndoorParams(u);
  appendOrientaDebugParams(u);
  appendOrientaMapPosLogParams(u);
  appendPdrParams(u);
  return u.pathname + "?" + u.searchParams.toString();
}

export default function PaxEntryWrapper() {
  const paxIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pid = useMemo(() => {
    return (qs("pid") || qs("pax") || qs("pix") || "").trim();
  }, []);
  const tenantId = useMemo(() => qs("tenant") || "airchina", []);

  const incomingName = useMemo(() => (qs("name") || "").trim(), []);
  const incomingPlan = useMemo<"free" | "premium">(() => normalizePlan(qs("plan")), []);

  const skipToPaxHtml = useMemo(
    () => qs("direct") === "1" || qs("skip") === "1",
    []
  );

  const skipToPaxDialogAndVideo = useMemo(() => {
    const view = (qs("view") || "").trim().toLowerCase();
    return view === "video";
  }, []);

  const [iframeSrc, setIframeSrc] = useState<string>(() => {
    if (skipToPaxHtml) return buildPaxHtmlSrc(location.origin, tenantId, pid);
    if (skipToPaxDialogAndVideo) return buildPaxDialogVideoSrc(location.origin, tenantId, pid);
    const u = new URL("/pax-login.html", location.origin);
    u.searchParams.set("pid", pid);
    u.searchParams.set("tenant", tenantId);
    appendOrientaDebugParams(u);
    appendOrientaMapPosLogParams(u);
    return u.pathname + "?" + u.searchParams.toString();
  });

  useEffect(() => {
    document.title = skipToPaxHtml ? "Orienta · 旅客端（快捷预览）" : "Orienta · 旅客端";
  }, [skipToPaxHtml]);

  useEffect(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    try {
      g.__ORIENTA_NAV_PATH_STEPS__ = [];
      g.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = [];
    } catch { /* ignore */ }
    function onNavPathDebug(ev: MessageEvent) {
      if (ev.source !== paxIframeRef.current?.contentWindow) return;
      const data = ev.data as { type?: string; pathSteps?: unknown } | null;
      if (!data || data.type !== "orienta-nav-path-debug") return;
      try {
        const steps = Array.isArray(data.pathSteps) ? data.pathSteps : [];
        g.__ORIENTA_NAV_PATH_STEPS__ = steps;
        g.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = steps.filter(
          (x: { category?: string } | null) => x && x.category === "waypoint"
        );
      } catch { /* ignore */ }
    }
    window.addEventListener("message", onNavPathDebug);
    return () => window.removeEventListener("message", onNavPathDebug);
  }, []);

  useEffect(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    type PaxWin = Window & {
      orientaDumpTouristPosition?: () => unknown;
      orientaGetTouristPositionHistory?: () => unknown;
      orientaClearTouristPositionHistory?: () => unknown;
    };
    function delegateFromPaxShell<K extends keyof PaxWin>(name: K) {
      return function () {
        const w = paxIframeRef.current?.contentWindow as PaxWin | undefined;
        if (!w) return { error: "pax iframe not ready" };
        try {
          const fn = w[name];
          if (typeof fn === "function") return (fn as () => unknown).call(w);
          return { error: `pax.html has no ${String(name)} yet` };
        } catch (e) { return { error: String(e) }; }
      };
    }
    g.orientaDumpTouristPosition = delegateFromPaxShell("orientaDumpTouristPosition");
    g.orientaGetTouristPositionHistory = delegateFromPaxShell("orientaGetTouristPositionHistory");
    g.orientaClearTouristPositionHistory = delegateFromPaxShell("orientaClearTouristPositionHistory");
    return () => {
      try { delete g.orientaDumpTouristPosition; delete g.orientaGetTouristPositionHistory; delete g.orientaClearTouristPositionHistory; } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || data.type !== "orienta_entry") return;
      const payload: EntryPayload = data.payload || {};
      const requestedPlan = payload.mode === "paid" ? "premium" : "free";
      const plan: "free" | "premium" = incomingPlan === "premium" ? "premium" : requestedPlan;
      const name = incomingName || "Guest";
      const intent = (payload.type || "").toLowerCase();

      if (intent === "depart" || intent === "arrive" || intent === "transfer") {
        setIframeSrc(buildPaxFlightSrc(
          location.origin, tenantId, pid, plan, name,
          intent as "depart" | "arrive" | "transfer",
          { flight: payload.flight, arr: payload.arrivalFlight, dep: payload.departureFlight },
        ));
        return;
      }

      const u = new URL("/pax.html", location.origin);
      u.searchParams.set("tenant", tenantId);
      u.searchParams.set("pax", pid);
      u.searchParams.set("plan", plan);
      u.searchParams.set("name", name);
      u.searchParams.set("hub", (qs("hub") || "PEK").trim());
      {
        const gf = (qs("gateFrom") || "").trim();
        const gt = (qs("gateTo") || "").trim();
        if (gf) u.searchParams.set("gateFrom", gf);
        if (gt) u.searchParams.set("gateTo", gt);
      }
      if (payload.arrivalFlight)   u.searchParams.set("arr", payload.arrivalFlight);
      if (payload.departureFlight) u.searchParams.set("dep", payload.departureFlight);
      if (payload.message)  u.searchParams.set("q", payload.message);
      if (payload.flight)   u.searchParams.set("flight", payload.flight);
      if (payload.type)     u.searchParams.set("intent", payload.type);
      appendRouteSiteParams(u);
      appendRouteSiteIndoorParams(u);
      appendOrientaDebugParams(u);
      appendOrientaMapPosLogParams(u);
      appendPdrParams(u);
      setIframeSrc(u.pathname + "?" + u.searchParams.toString());
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pid, tenantId, incomingName, incomingPlan]);

  return (
    <div style={{
      width: "100vw", height: "100vh", display: "flex", flexDirection: "column",
      background: "linear-gradient(180deg, #c8102e 0px, #c8102e 4px, transparent 4px), linear-gradient(180deg, #f5f6fa 0%, #e8ecf2 50%, #dde2ea 100%)",
    }}>
      <iframe
        ref={paxIframeRef}
        title="Passenger"
        src={iframeSrc}
        style={{ flex: 1, minHeight: 0, width: "100%", border: "none" }}
        allow="accelerometer; gyroscope; magnetometer; clipboard-read; clipboard-write"
      />
    </div>
  );
}
