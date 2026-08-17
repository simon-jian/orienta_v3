import { existsSync, readFileSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

const UPGRADE_INSECURE = "upgrade-insecure-requests";

/** True when the browser→Node request was HTTPS (TLS or reverse-proxy forwarded proto). */
export function isBrowserRequestHttps(req: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket?: any;
  headers?: IncomingHttpHeaders;
}): boolean {
  const xf = String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    ?.trim()
    ?.toLowerCase();
  if (xf === "https") return true;
  return !!(req.socket as { encrypted?: boolean } | undefined)?.encrypted;
}

/**
 * Django (and similar) often redirect to `https://<lan-ip>:3001/...` when `SECURE_SSL_REDIRECT` is on.
 * The browser then leaves the Vite proxy and hits plain HTTP on 443/TLS → `ERR_SSL_PROTOCOL_ERROR`.
 * Rewrite redirects that target the same host:port as `upstreamRoot` to stay under `browserPathPrefix`.
 */
export function rewriteLocationHeaderToBrowserProxyPrefix(
  proxyRes: IncomingMessage,
  upstreamRoot: string,
  browserPathPrefix: string,
): void {
  const code = proxyRes.statusCode;
  if (!code || code < 300 || code >= 400) return;
  const raw = proxyRes.headers.location;
  if (!raw) return;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  if (typeof loc !== "string") return;

  let upstream: URL;
  try {
    upstream = new URL(upstreamRoot.replace(/\/+$/, "") + "/");
  } catch {
    return;
  }

  let abs: URL;
  try {
    abs = new URL(loc, upstream);
  } catch {
    return;
  }

  if (abs.host !== upstream.host) return;

  const prefix = browserPathPrefix.replace(/\/$/, "") || "";
  const path = (abs.pathname || "/") + (abs.search || "") + (abs.hash || "");
  proxyRes.headers.location = prefix + path;
}

/**
 * Inlined before `</head>` so stale upstream `airport-map.html` that still calls `https://…:3001/api/…`
 * rewrites those fetches to `location.origin + apiBase + /api/…` when `?apiBase=/…` is present.
 */
export function injectIndoorMapFetchPatchHtml(htmlUtf8: string): string {
  if (htmlUtf8.includes("orienta-indoor-fetch-patch-inline")) return htmlUtf8;
  const inject =
    "<script>/*orienta-indoor-fetch-patch-inline*/(function(){try{var sp=new URLSearchParams(location.search);" +
    "var apiBase=(sp.get('apiBase')||'').replace(/\\/$/, '');if(!apiBase||apiBase.charAt(0)!=='/')return;var o=window.fetch;" +
    "window.fetch=function(input,init){function r(u){if(typeof u!=='string')return u;" +
    "if(!new RegExp('//[^/]+:3001/api/').test(u))return u;try{var p=new URL(u);" +
    "return location.origin+apiBase+p.pathname+p.search+p.hash}catch(e){return u}}" +
    "if(typeof input==='string')return o(r(input),init);if(typeof Request!=='undefined'&&input instanceof Request){" +
    "var n=r(input.url);if(n===input.url)return o(input,init);return o(new Request(n,input),init)}return o(input,init)}}catch(e){}})();<\/script>";
  if (/<\/head>/i.test(htmlUtf8)) {
    return htmlUtf8.replace(/<\/head>/i, `${inject}</head>`);
  }
  return inject + htmlUtf8;
}

/** Runs after upstream inline script so tiles hit `/indoor-map/tile/…` (Vite proxy) instead of `https://origin:443/tile/…`. */
export function injectIndoorMapTileFixBeforeBodyClose(htmlUtf8: string): string {
  if (htmlUtf8.includes("orienta-tile-under-proxy")) return htmlUtf8;
  const fix =
    "<script>/*orienta-tile-under-proxy*/(function(){if((location.pathname||'').indexOf('/indoor-map')>=0){" +
    "window.__OSM_TILE__=location.origin+'/indoor-map/tile/{z}/{x}/{y}.png';}})();<\/script>";
  if (/<\/body>/i.test(htmlUtf8)) {
    return htmlUtf8.replace(/<\/body>/i, `${fix}</body>`);
  }
  return htmlUtf8 + fix;
}

/**
 * Ensure admin pax markers show name+status (not bare ID) and notify the
 * parent dashboard on click — works for both repo and upstream airport-map.html.
 */
export function patchAdminPassengerMarkerUx(htmlUtf8: string): string {
  const needle =
    "mk.bindTooltip(id + (st ? ' · ' + st : ''), { direction: 'top', offset: [0, -8] });";
  if (!htmlUtf8.includes(needle)) return htmlUtf8;
  const replacement = [
    "var nm = String(p.name || '').trim();",
    "var label = (nm || id) + (st ? ' · ' + st : '');",
    "mk.__orientaPax = { id: id, name: nm, status: st };",
    "mk.bindTooltip(label, { direction: 'top', offset: [0, -8], sticky: true });",
    "if (!mk.__orientaSelectBound) {",
    "  mk.__orientaSelectBound = 1;",
    "  mk.on('click', function () {",
    "    try {",
    "      var info = mk.__orientaPax || { id: id, name: '', status: '' };",
    "      var spClick = new URLSearchParams(window.location.search || '');",
    "      var po = (spClick.get('parentOrigin') || '').trim();",
    "      try { po = decodeURIComponent(po); } catch (ePo) {}",
    "      var target = po || window.location.origin;",
    "      window.parent.postMessage({",
    "        type: 'orienta-admin-select-passenger',",
    "        passengerId: info.id,",
    "        name: info.name || '',",
    "        status: info.status || ''",
    "      }, target);",
    "    } catch (eClick) {}",
    "  });",
    "}",
  ].join("\n            ");
  return htmlUtf8.split(needle).join(replacement);
}

/**
 * Prefer `?airport=SFO` (passenger flight page) over localStorage PEK default.
 * Patches initAirportFilter when possible; otherwise injects a late apply.
 */
export function patchAirportQueryParamInit(htmlUtf8: string): string {
  const replacement = [
    "var code = 'PEK';",
    "    try {",
    "        var urlAp = (new URLSearchParams(location.search).get('airport') || '').trim().toUpperCase();",
    "        if (urlAp && AIRPORTS[urlAp]) code = urlAp;",
    "        else {",
    "            var saved = localStorage.getItem(LS_AIRPORT);",
    "            if (saved && AIRPORTS[saved]) code = saved;",
    "        }",
    "    } catch (_) {}",
  ].join("\n");

  const re =
    /var code = 'PEK';\s*try \{\s*var saved = localStorage\.getItem\(LS_AIRPORT\);\s*if \(saved && AIRPORTS\[saved\]\) code = saved;\s*\} catch \(_\) \{\}/g;
  if (re.test(htmlUtf8)) {
    return htmlUtf8.replace(re, replacement);
  }

  if (htmlUtf8.includes("orienta-url-airport-init")) return htmlUtf8;
  const inject =
    "<script>/*orienta-url-airport-init*/(function(){try{var a=(new URLSearchParams(location.search).get('airport')||'').trim().toUpperCase();" +
    "if(!a)return;function go(){try{if(typeof AIRPORTS==='undefined'||!AIRPORTS[a])return false;" +
    "var fa=document.getElementById('fltAirport');if(!fa)return false;if(fa.value===a)return true;fa.value=a;" +
    "if(typeof onAirportFilterChange==='function')onAirportFilterChange();return true}catch(e){return false}}" +
    "if(!go()){setTimeout(go,120);setTimeout(go,600)}}catch(e){}})();<\/script>";
  if (/<\/body>/i.test(htmlUtf8)) {
    return htmlUtf8.replace(/<\/body>/i, `${inject}</body>`);
  }
  return htmlUtf8 + inject;
}

/**
 * Hide the map's own airport picker for the operator dashboard, which now owns
 * that choice and passes it as `?airport=`. Two pickers meant two sources of
 * truth: switching inside the iframe left React still thinking it was showing
 * the tenant's default airport. Passenger/kiosk embeds are untouched.
 */
export function patchHideAirportSwitcherForOperator(htmlUtf8: string): string {
  if (htmlUtf8.includes("orienta-hide-map-airport-switcher")) return htmlUtf8;
  const style =
    "<style>/*orienta-hide-map-airport-switcher*/.mapctl-fg:has(> #fltAirport){display:none}</style>";
  if (/<\/head>/i.test(htmlUtf8)) {
    return htmlUtf8.replace(/<\/head>/i, `${style}</head>`);
  }
  return style + htmlUtf8;
}

export function transformAirportMapHtmlFromSource(
  htmlUtf8: string,
  opts?: { mapRole?: string },
): string {
  let html = injectIndoorMapFetchPatchHtml(htmlUtf8);
  html = injectIndoorMapTileFixBeforeBodyClose(html);
  html = patchAdminPassengerMarkerUx(html);
  html = patchAirportQueryParamInit(html);
  if (opts?.mapRole === "operator") html = patchHideAirportSwitcherForOperator(html);
  html = html
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4\/dist\/leaflet\.css/gi, "/vendor/leaflet/leaflet.css")
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4\/dist\/leaflet\.js/gi, "/vendor/leaflet/leaflet.js");
  return html;
}

export async function fetchUpstreamAirportMapHtml(
  upstreamBase: string,
  queryString: string,
  options?: { fallbackHtmlPath?: string },
): Promise<{ status: number; html: string; contentType: string | null }> {
  const base = upstreamBase.replace(/\/+$/, "");
  const q = queryString.startsWith("?") ? queryString : queryString ? `?${queryString}` : "";
  const url = `${base}/airport-map.html${q}`;
  const mapRole = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q).get("mapRole") || undefined;
  try {
    const r = await fetch(url);
    let text = await r.text();
    text = transformAirportMapHtmlFromSource(text, { mapRole });
    return {
      status: r.status,
      html: text,
      contentType: r.headers.get("content-type"),
    };
  } catch (err) {
    const fb = options?.fallbackHtmlPath;
    if (fb && existsSync(fb)) {
      const text = transformAirportMapHtmlFromSource(readFileSync(fb, "utf8"), { mapRole });
      return { status: 200, html: text, contentType: "text/html; charset=utf-8" };
    }
    throw err;
  }
}

/** Browsers may cache an old Apache copy of this URL at the same host; avoid "200 (from disk cache)" poisoning dev. */
export function applyAirportMapNoCacheHeaders(res: { setHeader(name: string, value: string): void }): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
}

/** Apply CSP / strip X-Frame-Options for indoor-map HTML. Only add `upgrade-insecure-requests` when `upgradeInsecure` is true (HTTPS page); on plain HTTP it can break same-origin tile loads in some browsers. */
export function applyIframeSafeHtmlHeaders(
  res: { setHeader(name: string, value: string | string[]): void },
  upgradeInsecure = false,
): void {
  const headers: IncomingHttpHeaders = {};
  prepareIndoorMapProxyResponse(headers, true, upgradeInsecure);
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (v !== undefined) res.setHeader(k, v as string | string[]);
  }
}

/**
 * - Strip headers that block <iframe> embedding.
 * - For **HTML documents** only: optionally merge CSP with `upgrade-insecure-requests` when the
 *   page is served over **HTTPS** so legacy `http:` subresources upgrade. On **HTTP** dev (e.g.
 *   `http://100.x:5174`) omit it — otherwise some UAs upgrade same-origin tile URLs to `https:`
 *   and the Vite HTTP server has no TLS → grey map.
 * - Subresource responses must not get a document CSP.
 */
export function prepareIndoorMapProxyResponse(
  headers: IncomingHttpHeaders,
  isHtmlDocument: boolean,
  upgradeInsecureRequests = false,
): void {
  delete headers["x-frame-options"];
  delete headers["X-Frame-Options"];
  if (!isHtmlDocument) return;

  const raw = headers["content-security-policy"];
  const cspIn = Array.isArray(raw) ? raw.join(", ") : raw;
  let base = "";
  if (typeof cspIn === "string" && cspIn.trim()) {
    base = cspIn
      .split(";")
      .map((s) => s.trim())
      .filter((s) => {
        if (!s.length || /^frame-ancestors\s/i.test(s)) return false;
        if (!upgradeInsecureRequests && /^upgrade-insecure-requests$/i.test(s)) return false;
        return true;
      })
      .join("; ");
  }
  if (upgradeInsecureRequests && !base.toLowerCase().includes(UPGRADE_INSECURE)) {
    base = base ? `${base}; ${UPGRADE_INSECURE}` : UPGRADE_INSECURE;
  }
  if (base.trim()) {
    headers["content-security-policy"] = base;
  } else {
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
  }
}
