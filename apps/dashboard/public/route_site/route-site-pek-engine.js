/**
 * route_site engine #1 — PEK timeline/clip + POI-gate graph (Multi-airport Phase 4).
 *
 * Utilities + config accessor, CSV timeline parsing, gate-clip/floor logic, POI
 * gate-anchor loading, the E-gate adjacency graph + Dijkstra, and the map polyline
 * builder. Loads after config-bootstrap.js and before route-site-map-geometry.js /
 * route-site-main.js. Split verbatim from the former route-site-app.js; load order
 * preserves the original execution order.
 */
try {
  window.__ORIENTA_NAV_PATH_STEPS__ = [];
  window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = [];
} catch (eNavInit) {}
try {
  window.orientaDumpTouristPosition = function () {
    return window.__ORIENTA_LAST_TOURIST_MAP_POS__;
  };
  window.orientaGetTouristPositionHistory = function () {
    var h = window.__ORIENTA_TOURIST_MAP_POS_HISTORY__;
    return Array.isArray(h) ? h.slice() : [];
  };
  window.orientaClearTouristPositionHistory = function () {
    if (typeof orientaClearTouristMapHistory_ === "function") orientaClearTouristMapHistory_();
  };
} catch (eDumpTouristInit) {}
(function orientaRouteSiteDebugBootstrap_(){
  var sp0 = new URLSearchParams(location.search);
  var on = /^(1|true|yes)$/i.test(String(sp0.get("orientaDebug") || "").trim()) ||
    /^(1|true|yes)$/i.test(String(sp0.get("debug") || "").trim());
  if (!on) return;
  var orientaAppendDebugLine_ = null;
  function ensure() {
    if (orientaAppendDebugLine_) return;
    if (!document.getElementById("orienta-debug-scrollbar-style")) {
      var st = document.createElement("style");
      st.id = "orienta-debug-scrollbar-style";
      st.textContent =
        "#debug>.orienta-debug-scroll{scrollbar-width:none;-ms-overflow-style:none}" +
        "#debug>.orienta-debug-scroll::-webkit-scrollbar{width:0;height:0}";
      document.head.appendChild(st);
    }
    var el = document.createElement("div");
    el.id = "debug";
    el.setAttribute("style", "position:fixed;left:0;right:0;top:0;bottom:auto;max-height:32vh;z-index:2147483647;display:flex;flex-flow:row nowrap;align-items:stretch;box-sizing:border-box;background:rgba(20,20,24,.94);color:#f1f5f9;font:11px/1.35 ui-monospace,monospace;border-bottom:2px solid var(--accent,#22d3ee);word-break:break-word;");
    var scrollInner = document.createElement("div");
    scrollInner.className = "orienta-debug-scroll";
    scrollInner.setAttribute("style", "flex:1 1 auto;min-width:0;min-height:0;max-height:32vh;overflow-x:hidden;overflow-y:scroll;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding:max(6px,env(safe-area-inset-top,0px)) 4px 6px 8px;");
    var rail = document.createElement("div");
    rail.setAttribute("title", "Scroll debug log");
    rail.setAttribute("style", "width:22px;flex-shrink:0;min-height:0;align-self:stretch;background:linear-gradient(90deg,#0b1220,#1e293b);border-left:1px solid #64748b;position:relative;touch-action:none;-webkit-tap-highlight-color:transparent;");
    var thumb = document.createElement("div");
    thumb.setAttribute("style", "position:absolute;left:5px;width:11px;border-radius:6px;background:#e2e8f0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);top:6px;height:36px;touch-action:none;");
    rail.appendChild(thumb);
    el.appendChild(scrollInner);
    el.appendChild(rail);
    function orientaDebugSyncRail_() {
      var sh = scrollInner.scrollHeight;
      var ch = scrollInner.clientHeight;
      var rh = rail.clientHeight || ch;
      if (sh <= ch + 2) {
        thumb.style.height = Math.max(28, rh - 12) + "px";
        thumb.style.top = "6px";
        thumb.style.opacity = "0.4";
        return;
      }
      thumb.style.opacity = "0.95";
      var th = Math.max(32, Math.floor((ch / sh) * rh));
      th = Math.min(th, rh - 12);
      var maxTop = Math.max(0, rh - th - 8);
      var p = scrollInner.scrollTop / Math.max(1, sh - ch);
      thumb.style.height = th + "px";
      thumb.style.top = (6 + p * maxTop) + "px";
    }
    scrollInner.addEventListener("scroll", orientaDebugSyncRail_, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      try {
        new ResizeObserver(orientaDebugSyncRail_).observe(scrollInner);
      } catch (eRo) {}
    }
    var railDragY = null;
    function orientaDbgTouchY_(ev) {
      return ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0;
    }
    thumb.addEventListener(
      "touchstart",
      function (ev) {
        railDragY = orientaDbgTouchY_(ev);
        ev.stopPropagation();
      },
      { passive: true }
    );
    thumb.addEventListener(
      "touchmove",
      function (ev) {
        if (railDragY == null) return;
        var sh = scrollInner.scrollHeight;
        var ch = scrollInner.clientHeight;
        if (sh <= ch + 2) return;
        var y = orientaDbgTouchY_(ev);
        var dy = y - railDragY;
        railDragY = y;
        var rh = rail.clientHeight;
        var th = thumb.offsetHeight || 36;
        var maxTop = Math.max(1, rh - th - 8);
        var maxScroll = Math.max(1, sh - ch);
        scrollInner.scrollTop = Math.max(0, Math.min(maxScroll - 1e-6, scrollInner.scrollTop + (dy / maxTop) * maxScroll));
        orientaDebugSyncRail_();
        ev.preventDefault();
        ev.stopPropagation();
      },
      { passive: false }
    );
    thumb.addEventListener("touchend", function () {
      railDragY = null;
    });
    rail.addEventListener(
      "touchstart",
      function (ev) {
        if (ev.target === thumb) return;
        var sh = scrollInner.scrollHeight;
        var ch = scrollInner.clientHeight;
        if (sh <= ch + 2) return;
        var rect = rail.getBoundingClientRect();
        var y = orientaDbgTouchY_(ev) - rect.top;
        var frac = Math.max(0, Math.min(1, y / rect.height));
        scrollInner.scrollTop = frac * (sh - ch);
        orientaDebugSyncRail_();
        ev.stopPropagation();
      },
      { passive: true }
    );
    document.body.appendChild(el);
    try {
      document.documentElement.style.overscrollBehavior = "none";
    } catch (eOs) {}
    requestAnimationFrame(orientaDebugSyncRail_);
    var dbgScrollLastY = null;
    scrollInner.addEventListener(
      "touchstart",
      function (ev) {
        dbgScrollLastY = orientaDbgTouchY_(ev);
        ev.stopPropagation();
      },
      { passive: true }
    );
    scrollInner.addEventListener(
      "touchmove",
      function (ev) {
        var y = orientaDbgTouchY_(ev);
        var dy = dbgScrollLastY != null ? y - dbgScrollLastY : 0;
        dbgScrollLastY = y;
        var sh = scrollInner.scrollHeight;
        var ch = scrollInner.clientHeight;
        if (scrollInner.scrollTop <= 0 && dy > 0) ev.preventDefault();
        if (sh > ch + 2 && scrollInner.scrollTop >= sh - ch - 2 && dy < 0) ev.preventDefault();
        if (sh > ch + 2) ev.stopPropagation();
      },
      { passive: false }
    );
    scrollInner.addEventListener(
      "touchend",
      function () {
        dbgScrollLastY = null;
      },
      { passive: true }
    );
    orientaAppendDebugLine_ = function (msg, bad) {
      var t = document.createElement("div");
      t.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px solid #334155;color:" + (bad ? "#fca5a5" : "#e2e8f0");
      t.textContent = "[" + new Date().toISOString().slice(11, 23) + "] " + msg;
      scrollInner.appendChild(t);
      scrollInner.scrollTop = scrollInner.scrollHeight;
      requestAnimationFrame(orientaDebugSyncRail_);
    };
    orientaAppendDebugLine_("route_site orientaDebug · " + String(location.href).slice(0, 220), false);
    window.addEventListener("error", function (ev) {
      orientaAppendDebugLine_("window.error: " + (ev && ev.message ? ev.message : String(ev)) +
        " @" + (ev.filename || "") + ":" + (ev.lineno || "") + ":" + (ev.colno || ""), true);
    });
    window.addEventListener("unhandledrejection", function (ev) {
      var r = ev.reason;
      orientaAppendDebugLine_("unhandledrejection: " + (r && r.stack ? r.stack : String(r)), true);
    });
    var _nf = window.fetch;
    window.fetch = function (input, init) {
      var url = "";
      try {
        url = typeof input === "string" ? input : (input && input.url) ? String(input.url) : String(input);
      } catch (eu) { url = "(url)"; }
      return _nf.apply(this, arguments).then(function (res) {
        if (!res.ok) orientaAppendDebugLine_("fetch HTTP " + res.status + " " + res.statusText + " " + url, true);
        return res;
      }, function (err) {
        orientaAppendDebugLine_("fetch failed: " + url + " -> " + (err && err.message ? err.message : String(err)), true);
        throw err;
      });
    };
  }
  window.orientaRouteSiteDbg_ = function (msg, bad) {
    ensure();
    if (orientaAppendDebugLine_) orientaAppendDebugLine_(String(msg), !!bad);
  };
  ensure();
})();
function orientaRouteSiteDebugLog_(msg, bad) {
  try {
    if (typeof window.orientaRouteSiteDbg_ === "function") window.orientaRouteSiteDbg_(String(msg), !!bad);
  } catch (eLog) {}
}
(function(){
  // config-bootstrap.js resolves the hub; only fall back here if it didn't run.
  if (typeof window.__ROUTESITE_HUB__ === 'string' && window.__ROUTESITE_HUB__) return;
  var sp = new URLSearchParams(location.search);
  window.__ROUTESITE_HUB__ = (sp.get('airport') || sp.get('hub') || 'PEK').toUpperCase();
})();
/** Resolved route_site config (from config-bootstrap.js → config/<hub>.json). */
function orientaRouteSiteCfg_() { return (window.__ROUTESITE_CONFIG__ || {}); }
function orientaParseVideoTimeToSeconds_(s) {
  var txt = String(s || '').trim();
  if (!txt) return 0;
  var parts = txt.split(':').map(function(x){ return String(x).trim(); });
  if (parts.length === 2) {
    var mm = parseInt(parts[0], 10), sec = parseFloat(parts[1]);
    if (isFinite(mm) && isFinite(sec)) return mm * 60 + sec;
  }
  if (parts.length === 3) {
    var h = parseInt(parts[0],10), mm = parseInt(parts[1],10), sec = parseFloat(parts[2]);
    if (isFinite(h) && isFinite(mm) && isFinite(sec)) return h * 3600 + mm * 60 + sec;
  }
  var n = parseFloat(txt);
  return isFinite(n) ? n : 0;
}
/** CSV 第一列 Gate_E32 / Security_… → 与 URL gateFrom 对齐的键（大写、去 GATE_ 前缀） */
function orientaNormPekCsvGate_(poiCell) {
  return String(poiCell || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^GATE_/, '');
}
function orientaPickPekVideoBasenameFromQuery_() {
  try {
    var sp = new URLSearchParams(location.search);
    var raw = (sp.get('pekVideo') || sp.get('pekVideoFile') || '').trim();
    if (!raw) return '';
    var base = raw.replace(/\\/g, '/').split('/').pop() || '';
    if (!/^[a-zA-Z0-9_.\-]+\.(mp4|MP4)$/i.test(base)) return '';
    return base;
  } catch (eP) {
    return '';
  }
}
/** Prefer dynamic merged route video for current gate pair (from/to) if server endpoint is available. */
function orientaApiUrl_(p) {
  return typeof window.orientaUrl === "function" ? window.orientaUrl(p) : p;
}
/** Merged-video endpoint (config-driven; falls back to the legacy PEK alias). */
function orientaMergeEndpoint_() {
  var v = orientaRouteSiteCfg_().video;
  return (v && v.mergeEndpoint) || '/api/orienta/pek-merged-video';
}
function orientaPickPekDynamicMergedFromApiSync_(fromIdx, toIdx) {
  try {
    var u = '';
    if (Number.isFinite(fromIdx) && Number.isFinite(toIdx) && fromIdx >= 0 && toIdx > fromIdx) {
      u =
        orientaApiUrl_(orientaMergeEndpoint_() + '?fromIdx=' +
        encodeURIComponent(String(fromIdx)) +
        '&toIdx=' +
        encodeURIComponent(String(toIdx)));
    } else {
      var sp = new URLSearchParams(location.search);
      var from = orientaNormalizeGate_(sp.get('from') || sp.get('origin') || sp.get('gateFrom') || '');
      var to = orientaNormalizeGate_(sp.get('to') || sp.get('dest') || sp.get('destination') || sp.get('gateTo') || '');
      if (!from || !to) return '';
      u = orientaApiUrl_(orientaMergeEndpoint_() + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
    }
    var x = new XMLHttpRequest();
    x.open('GET', u, false);
    x.send(null);
    if (x.status < 200 || x.status >= 300) return '';
    var j = null;
    try { j = JSON.parse(x.responseText || '{}'); } catch (eJ) { j = null; }
    if (!j || !j.ok || !j.url) return '';
    return String(j.url).trim();
  } catch (eDyn) {
    return '';
  }
}
/** Vite 等对缺失静态资源常 200 回 SPA（text/html）；必须带 video 类 MIME 才算真有文件 */
function orientaPekProbeStaticOkSync_(basename) {
  if (!basename) return false;
  try {
    var x = new XMLHttpRequest();
    x.open('HEAD', basename, false);
    x.send(null);
    if (x.status < 200 || x.status >= 400) return false;
    var ct = (x.getResponseHeader('Content-Type') || '').toLowerCase();
    if (ct.indexOf('video/') >= 0) return true;
    if (ct.indexOf('application/octet-stream') >= 0) return true;
    return false;
  } catch (eH) {
    return false;
  }
}
/** 与 route_site 重定位、裁切、concat 共用的时间轴源 */
var ORIENTA_PEK_GATE_CSV = (orientaRouteSiteCfg_().video && orientaRouteSiteCfg_().video.gateCsv) || 'PEK_gate_timestamp_full_with_E24_E36.csv';
/** 由 concat 脚本根据 ORIENTA_PEK_GATE_CSV 生成的整条母带（不覆盖原始分段素材） */
var ORIENTA_PEK_MERGED_FROM_CSV_BASENAME = (orientaRouteSiteCfg_().video && orientaRouteSiteCfg_().video.mergedFromCsvBasename) || 'PEK_gate_timestamp_merged.mp4';
function orientaPekIsFullTimelineBasename_(name) {
  if (!name) return false;
  if (new RegExp('^' + ORIENTA_PEK_MERGED_FROM_CSV_BASENAME.replace(/\./g, '\\.') + '$', 'i').test(name)) return true;
  if (/^pek_videoroute_e\.mp4$/i.test(name)) return true;
  return false;
}
/** Unique `video` basenames from parsed CSV rows (order preserved), for static HEAD fallback after merged. */
function orientaCollectPekVideoBasenamesFromRows_(rows) {
  var seen = Object.create(null);
  var out = [];
  if (!rows || !rows.length) return out;
  for (var i = 0; i < rows.length; i++) {
    var vn = String(rows[i].video || '').trim();
    if (!vn || /^video$/i.test(vn)) continue;
    var base = vn.replace(/\\/g, '/').split('/').pop() || vn;
    if (!/\.mp4$/i.test(base)) base = base + '.mp4';
    var key = base.toLowerCase();
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(base);
  }
  return out;
}
/** 优先 CSV 母带 → 旧名母带 → CSV 中出现的分段名 → 旧版硬编码分段；?pekVideo= 优先 */
function orientaPickFirstExistingPekVideoBasename_(pekBn, csvVideoBasenames) {
  var out = [];
  if (pekBn) out.push(pekBn);
  out.push(
    ORIENTA_PEK_MERGED_FROM_CSV_BASENAME,
    'PEK_gate_timestamp_merged.MP4',
    'pek_videoroute_E.MP4',
    'pek_videoroute_E.mp4'
  );
  if (csvVideoBasenames && csvVideoBasenames.length) {
    for (var c = 0; c < csvVideoBasenames.length; c++) out.push(csvVideoBasenames[c]);
  }
  var __segs = (orientaRouteSiteCfg_().video && orientaRouteSiteCfg_().video.segmentBasenames) || [
    'PEK_T3E_F3_E24_E36.mp4',
    'PEK_T3E_F3_E32_Security_Checkpoint2.mp4',
    'PEK_T3E_Security_Checkpoint_2_F3_Escalator_2_F2.mp4',
    'PEK_T3E_F3_E32_Escalator_2.mp4',
    'PEK_T3E_Escalator_2_F3_F2.mp4',
    'PEK_T3E_F2_Escalator_2_E24.mp4'
  ];
  for (var s = 0; s < __segs.length; s++) out.push(__segs[s]);
  for (var i = 0; i < out.length; i++) {
    if (orientaPekProbeStaticOkSync_(out[i])) return out[i];
  }
  return pekBn || ORIENTA_PEK_MERGED_FROM_CSV_BASENAME;
}
function orientaLoadPekRowsSync_() {
  if (window.__ROUTESITE_HUB__ !== 'PEK') return null;
  var rows = null;
  var csvVideoBasenames = [];
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', ORIENTA_PEK_GATE_CSV, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) {
      var lines = (xhr.responseText || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      rows = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^point_of_interest/i.test(line)) continue;
        var m = line.match(/^([^,]+),\s*([^,]+),\s*([^,]+),\s*(.+)$/);
        if (!m) continue;
        var poi = m[1].trim();
        var floor = m[2].trim();
        var video = m[3].trim();
        var timePart = m[4].trim();
        var sec = orientaParseVideoTimeToSeconds_(timePart);
        if (!Number.isFinite(sec)) continue;
        rows.push({
          gate: orientaNormPekPoiKey_(poi) || orientaNormPekCsvGate_(poi),
          floor: floor,
          video: video,
          segmentTime: sec,
        });
      }
      if (!rows.length) rows = null;
      else csvVideoBasenames = orientaCollectPekVideoBasenamesFromRows_(rows);
    }
  } catch (eCsv) {
    rows = null;
  }
  var v = document.getElementById('vid');
  if (v) {
    var pekBn = orientaPickPekVideoBasenameFromQuery_();
    var dynPath = orientaPickPekDynamicMergedFromApiSync_();
    var pekPath = dynPath || orientaPickFirstExistingPekVideoBasename_(pekBn, csvVideoBasenames);
    try {
      window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ = pekPath;
    } catch (eW) {}
    v.src = pekPath + '?t=' + Date.now();
    v.addEventListener('error', function pekVidErr() {
      if (v.dataset.orientaPekFallback === '1') return;
      v.dataset.orientaPekFallback = '1';
      var low = (pekBn || pekPath || ORIENTA_PEK_MERGED_FROM_CSV_BASENAME).replace(/\.MP4$/i, '.mp4');
      if (low !== pekPath) v.src = low + '?t=' + Date.now();
    });
  }
  var b = document.getElementById('badgeVideo');
  if (b) {
    var srcBn = '';
    try {
      srcBn = String(window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ || '').trim();
    } catch (eBadge) {}
    if (srcBn && !orientaPekIsFullTimelineBasename_(srcBn))
      b.textContent =
        '首都机场 T3E · 预览 ' +
        srcBn +
        '（整段路线请生成 ' +
        ORIENTA_PEK_MERGED_FROM_CSV_BASENAME +
        '，在 orienta_v3 目录执行 python3 scripts/concat_pek_video_from_csv.py）';
    else b.textContent = '首都机场 T3E · 室内路线';
  }
  var bp = document.getElementById('badgeMapP');
  if (bp) bp.textContent = '室外地图（PEK）';
  return rows;
}
function orientaNormalizeGate_(g) {
  return String(g || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^GATE_/, '');
}
/** PEK: play only [t0,t1] on the full pek video. CSV defines gates; default = first→last row. ?pekFull=1 plays entire file. */
function orientaApplyPekGateClipFromQuery_(rows) {
  if (window.__ROUTESITE_HUB__ !== 'PEK' || !rows || !rows.length) return null;
  try {
    var sp = new URLSearchParams(location.search);
    var fv = (sp.get('pekFull') || sp.get('fullvideo') || '').toLowerCase();
    if (fv === '1' || fv === 'true' || fv === 'yes') return null;
    var fromG = orientaNormalizeGate_(sp.get('from') || sp.get('origin') || sp.get('gateFrom') || '');
    var toG = orientaNormalizeGate_(sp.get('to') || sp.get('dest') || sp.get('destination') || sp.get('gateTo') || '');
    var rawPax = String(sp.get('pax') || sp.get('pid') || sp.get('pix') || '').trim();
    var paxAlias = orientaRouteSiteCfg_().paxAliases || { DA8X3: "TX1", DB5K7: "TX3", DC2N9: "TX2" };
    var pax = paxAlias[(rawPax || '').toUpperCase()] || rawPax;
    var demoGateByPax = orientaRouteSiteCfg_().paxRouteGates || {
      TX1: { from: 'E16', to: 'E19' },
      TX2: { from: 'E18', to: 'E19' },
      TX3: { from: 'E17', to: 'E19' }
    };
    var demoPair = demoGateByPax[pax];
    if (demoPair) {
      fromG = orientaNormalizeGate_(demoPair.from);
      toG = orientaNormalizeGate_(demoPair.to);
    }
    var iFrom, iTo;
    if (!fromG || !toG) {
      iFrom = 0;
      iTo = rows.length - 1;
      if (iTo <= iFrom) return null;
      fromG = rows[iFrom].gate;
      toG = rows[iTo].gate;
    } else {
      var fromIdx = -1;
      var toIdx = -1;
      for (var ii = rows.length - 1; ii >= 0; ii--) {
        if (rows[ii].gate !== fromG) continue;
        var jj;
        for (jj = ii + 1; jj < rows.length; jj++) {
          if (rows[jj].gate === toG) break;
        }
        if (jj < rows.length) {
          fromIdx = ii;
          toIdx = jj;
          break;
        }
      }
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) return null;
      iFrom = fromIdx;
      iTo = toIdx;
    }
    var t0 = Number(rows[iFrom].segmentTime);
    var t1 = Number(rows[iTo].segmentTime);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null;
    return { t0: t0, t1: t1, fromGate: fromG, toGate: toG, fromIdx: iFrom, toIdx: iTo };
  } catch (e) { return null; }
}
/** 将 CSV 多段 video 的局部时间拼成与剪辑内视频 currentTime 一致的全局秒（从 clip 首行起算） */
function orientaAugmentPekRowsGlobalClipTime_(rows, clip) {
  if (!rows || !clip) return;
  var i0 = clip.fromIdx;
  var i1 = clip.toIdx;
  if (!(i1 >= i0)) return;
  var offset = 0;
  var curV = null;
  var maxLoc = 0;
  for (var i = i0; i <= i1; i++) {
    var r = rows[i];
    var v = String(r.video || '');
    if (v !== curV) {
      offset += maxLoc;
      curV = v;
      maxLoc = 0;
    }
    r.globalClipT = offset + Number(r.segmentTime);
    maxLoc = Math.max(maxLoc, Number(r.segmentTime));
  }
}
/** 首段 F2/L2 在 [t0,t1] 内的时间比例 → 与 orientaVideoProgress01FromCur_ 同域，用于分楼层轨迹与地图 */
function orientaComputePekFloorSwitchTimeFrac_(rows, clip) {
  if (!rows || !clip) return null;
  var t0 = rows[clip.fromIdx].globalClipT;
  var t1 = rows[clip.toIdx].globalClipT;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null;
  var tFirstF2 = null;
  for (var i = clip.fromIdx; i <= clip.toIdx; i++) {
    var fl = String(rows[i].floor || '').trim().toUpperCase();
    if (fl === 'F2' || fl === 'L2') {
      tFirstF2 = rows[i].globalClipT;
      break;
    }
  }
  if (tFirstF2 == null || !Number.isFinite(tFirstF2)) return null;
  return Math.max(0, Math.min(1, (tFirstF2 - t0) / (t1 - t0)));
}
/** 当前 gate 剪辑内是否只有 F3 或只有 F2（与 CSV floor 列一致）：用于单段视频、无 F3→F2 分界时避免错误地按 50% 切层 */
function orientaComputePekClipFloorMode_(rows, clip) {
  if (!rows || !clip || !(clip.toIdx >= clip.fromIdx)) return null;
  var has3 = false;
  var has2 = false;
  for (var i = clip.fromIdx; i <= clip.toIdx; i++) {
    var fl = String(rows[i].floor || "").trim().toUpperCase();
    if (fl === "F3" || fl === "L3") has3 = true;
    if (fl === "F2" || fl === "L2") has2 = true;
  }
  if (has3 && !has2) return "L3_ONLY";
  if (has2 && !has3) return "L2_ONLY";
  return null;
}
/** 把 0..1 的「剪辑内时间进度」映射到当前楼层子段上的 0..1，供 PATH_LONLAT 插值 */
function orientaPekRemapRatioForFloor_(timeFrac, sw, wantL3) {
  if (sw == null || !Number.isFinite(sw) || sw <= 0 || sw >= 1) return Math.max(0, Math.min(1, timeFrac));
  var tf = Math.max(0, Math.min(1, timeFrac));
  if (wantL3) {
    if (tf >= sw - 1e-5) return 1;
    return tf / sw;
  }
  if (tf <= sw + 1e-5) return 0;
  return (tf - sw) / (1 - sw);
}
/**
 * Same split as orientaPekRemapRatioForFloor_, but thresholds are **arc** fractions along the path
 * (0..1), not video-time fractions — required when `rawRatioMap` comes from CSV gate→distance sync.
 */
function orientaPekRemapGateArcForFloor_(arcFull01, arcSw01, wantL3) {
  if (arcSw01 == null || !Number.isFinite(arcSw01) || arcSw01 <= 1e-5 || arcSw01 >= 1 - 1e-5) {
    return Math.max(0, Math.min(1, Number(arcFull01)));
  }
  var af = Math.max(0, Math.min(1, Number(arcFull01)));
  var sw = Math.max(1e-6, Math.min(1 - 1e-6, Number(arcSw01)));
  if (wantL3) {
    if (af >= sw - 1e-5) return 1;
    return af / sw;
  }
  if (af <= sw + 1e-5) return 0;
  return (af - sw) / (1 - sw);
}
/** Clip-local seconds from first row to first F2/L2 row (same axis as orientaVideoLocalSecForGateSync_). */
function orientaPekFloorSwitchLocalSec_(rows, clip) {
  if (!rows || !clip || !(clip.toIdx >= clip.fromIdx)) return null;
  var gt0 = Number(rows[clip.fromIdx].globalClipT);
  if (!Number.isFinite(gt0)) return null;
  for (var i = clip.fromIdx; i <= clip.toIdx; i++) {
    var fl = String(rows[i].floor || "").trim().toUpperCase();
    if (fl === "F2" || fl === "L2") {
      var t = Number(rows[i].globalClipT);
      if (Number.isFinite(t)) return Math.max(0, t - gt0);
    }
  }
  return null;
}
/**
 * Schmitt latch: L3 vs L2 segment from video progress. A hard threshold (base < sw) flips on tiny
 * currentTime jitter near the CSV floor switch and makes the dot jump between disjoint polylines.
 */
var __orientaPekHystSw = null;
var __orientaPekHystWantL3 = null;
var __orientaPekHystLastBase = null;
function orientaPekVideoWantL3_(base, sw) {
  if (typeof __orientaPekClipFloorMode_ !== "undefined" && __orientaPekClipFloorMode_ === "L3_ONLY") return true;
  if (typeof __orientaPekClipFloorMode_ !== "undefined" && __orientaPekClipFloorMode_ === "L2_ONLY") return false;
  if (sw == null || !Number.isFinite(sw) || sw <= 0 || sw >= 1) return base < 0.5;
  var b = Math.max(0, Math.min(1, Number(base)));
  if (__orientaPekHystSw !== sw) {
    __orientaPekHystSw = sw;
    __orientaPekHystWantL3 = b < sw;
    __orientaPekHystLastBase = b;
  }
  if (
    __orientaPekHystLastBase != null &&
    Number.isFinite(__orientaPekHystLastBase) &&
    Math.abs(b - __orientaPekHystLastBase) > 0.12
  ) {
    __orientaPekHystWantL3 = b < sw;
  }
  __orientaPekHystLastBase = b;
  var h = 0.012;
  if (__orientaPekHystWantL3) {
    if (b > sw + h) __orientaPekHystWantL3 = false;
  } else {
    if (b < sw - h) __orientaPekHystWantL3 = true;
  }
  return __orientaPekHystWantL3;
}
var __pekRows = orientaLoadPekRowsSync_();
var __pekClip = orientaApplyPekGateClipFromQuery_(__pekRows);
/** 进页时 URL/默认路线的 fromIdx..toIdx；重定位只改播放裁切，列表仍用整段路线（含 L3） */
var __pekRouteClipBounds_ = null;
function orientaRememberPekRouteClipBounds_() {
  if (typeof __pekClip === 'undefined' || !__pekClip || !__pekRows) return;
  if (__pekRouteClipBounds_) return;
  __pekRouteClipBounds_ = {
    fromIdx: __pekClip.fromIdx,
    toIdx: __pekClip.toIdx,
    fromGate: __pekClip.fromGate,
    toGate: __pekClip.toGate,
  };
}
function orientaGetPekRelocatePickerClipBounds_() {
  if (__pekRouteClipBounds_) return __pekRouteClipBounds_;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    return { fromIdx: __pekClip.fromIdx, toIdx: __pekClip.toIdx };
  }
  return null;
}
var __pekFloorSwitchTimeFrac = null;
var __orientaPekClipFloorMode_ = null;
/** Seconds from clip start to first L2 row; for gate-arc floor remap (not video `sw`). */
var __orientaPekFloorSwitchLocalSec_ = null;
if (__pekRows && __pekRows.length) {
  orientaAugmentPekRowsGlobalClipTime_(__pekRows, { fromIdx: 0, toIdx: __pekRows.length - 1 });
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    var gt0 = __pekRows[__pekClip.fromIdx].globalClipT;
    var gt1 = __pekRows[__pekClip.toIdx].globalClipT;
    if (Number.isFinite(gt0) && Number.isFinite(gt1) && gt1 > gt0) {
      __pekClip.t0 = gt0;
      __pekClip.t1 = gt1;
    }
    __pekFloorSwitchTimeFrac = orientaComputePekFloorSwitchTimeFrac_(__pekRows, __pekClip);
    __orientaPekClipFloorMode_ = orientaComputePekClipFloorMode_(__pekRows, __pekClip);
    __orientaPekFloorSwitchLocalSec_ = orientaPekFloorSwitchLocalSec_(__pekRows, __pekClip);
    try {
      if (
        !orientaApplyPekRouteVideoForClip_(__pekClip.fromIdx, __pekClip.toIdx, { forceSegment: true })
      ) {
        orientaApplyPekDynamicMergedVideoForClip_(__pekClip.fromIdx, __pekClip.toIdx, {});
      }
    } catch (eVidInit) {}
    orientaRememberPekRouteClipBounds_();
  } else {
    var _fullClip = { fromIdx: 0, toIdx: __pekRows.length - 1 };
    __pekFloorSwitchTimeFrac = orientaComputePekFloorSwitchTimeFrac_(__pekRows, _fullClip);
    __orientaPekClipFloorMode_ = orientaComputePekClipFloorMode_(__pekRows, _fullClip);
    __orientaPekFloorSwitchLocalSec_ = orientaPekFloorSwitchLocalSec_(__pekRows, _fullClip);
  }
}
var __orientaPekPoiGateAnchorCache_ = null;
/** gate → { L2:[lng,lat], L3:[lng,lat] }，重定位按 CSV floor 取坐标 */
var __orientaPekPoiByFloorCache_ = null;
function orientaPekFloorStorageKey_(fl) {
  var f = String(fl || '').trim().toUpperCase();
  if (f === 'F3' || f === 'L3') return 'L3';
  if (f === 'F2' || f === 'L2') return 'L2';
  if (f === 'F1' || f === 'L1') return 'L1';
  return f || '';
}
function orientaResolvePekPoiApiBase_() {
  try {
    var sp = new URLSearchParams(location.search);
    var raw = String(sp.get("apiBase") || sp.get("poiApi") || "").trim();
    if (raw) return raw.replace(/\/+$/, "");
  } catch (e) {}
  if (typeof window.orientaUrl === "function") return window.orientaUrl("/indoor-map-api");
  return "/indoor-map-api";
}
/** CSV / 地图 POI 统一键：E32、ESCALATOR_2、SECURITY_CHECKPOINT2 … */
function orientaNormPekPoiKey_(raw) {
  var s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^GATE_/, '');
  if (/^E\d{1,2}$/.test(s)) return s;
  if (/ESCALATOR/i.test(s)) {
    var em = s.match(/ESCALATOR[_]?(\d+)/i) || s.match(/(\d+)/);
    if (em && em[1] != null) return 'ESCALATOR_' + String(parseInt(em[1], 10));
  }
  if (/SECURITY/i.test(s) && /CHECKPOINT/i.test(s)) return s.replace(/[^A-Z0-9_]/g, '') || s;
  return s;
}
function orientaPekExtractPoiAnchorKeyFromPoi_(props) {
  props = props || {};
  var vals = [props.gate, props.code, props.name_en, props.name, props.id].filter(function (v) {
    return v != null && String(v).trim();
  });
  for (var i = 0; i < vals.length; i++) {
    var key = orientaNormPekPoiKey_(vals[i]);
    if (!key) continue;
    if (/^E\d{1,2}$/.test(key)) return key;
    if (/^ESCALATOR_\d+$/.test(key)) return key;
    if (key.indexOf('SECURITY') >= 0 && key.indexOf('CHECKPOINT') >= 0) return key;
  }
  return '';
}
function orientaPekExtractGateKeyFromPoi_(props) {
  return orientaPekExtractPoiAnchorKeyFromPoi_(props);
}
function orientaPekPoiGateCategoryOk_(cat) {
  var c = String(cat || '').toLowerCase();
  return (
    c === 'gate' ||
    c === 'arrival' ||
    c === 'departure' ||
    c === 'escalator' ||
    c === 'elevator' ||
    c === 'security'
  );
}
function orientaPekFloorRank_(fl) {
  var f = String(fl || "").trim().toUpperCase();
  if (f === "L3" || f === "F3") return 3;
  if (f === "L2" || f === "F2") return 2;
  return 1;
}
/** 地图 POI API（airport-map / poi-editor）→ gate key → [lng,lat]；默认 L3 优先，重定位用 orientaLookupPekEGateLngLat_(g, floor) */
function orientaLoadPekPoiGateAnchorsSync_() {
  if (__orientaPekPoiGateAnchorCache_) return __orientaPekPoiGateAnchorCache_;
  var out = {};
  var byFloor = Object.create(null);
  var floorRank = Object.create(null);
  if (window.__ROUTESITE_HUB__ !== "PEK") {
    __orientaPekPoiGateAnchorCache_ = out;
    __orientaPekPoiByFloorCache_ = byFloor;
    return out;
  }
  try {
    var apiBase = orientaResolvePekPoiApiBase_();
    var url = apiBase + "/api/poi?terminal=" + encodeURIComponent(orientaRouteSiteCfg_().poiTerminalQuery || "T3E");
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) throw new Error("POI HTTP " + xhr.status);
    var data = JSON.parse(xhr.responseText || "{}");
    var features = Array.isArray(data.features) ? data.features : [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i] || {};
      var props = f.properties || {};
      if (!orientaPekPoiGateCategoryOk_(props.category)) continue;
      var key = orientaPekExtractPoiAnchorKeyFromPoi_(props);
      var c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
      var lng = c && isFinite(Number(c[0])) ? Number(c[0]) : Number(props.lon);
      var lat = c && isFinite(Number(c[1])) ? Number(c[1]) : Number(props.lat);
      if (!key || !isFinite(lng) || !isFinite(lat)) continue;
      var fk = orientaPekFloorStorageKey_(props.floor);
      if (fk) {
        if (!byFloor[key]) byFloor[key] = Object.create(null);
        byFloor[key][fk] = [lng, lat];
      }
      var rk = orientaPekFloorRank_(props.floor);
      if (floorRank[key] == null || rk >= floorRank[key]) {
        floorRank[key] = rk;
        out[key] = [lng, lat];
      }
    }
  } catch (e) {}
  __orientaPekPoiGateAnchorCache_ = out;
  __orientaPekPoiByFloorCache_ = byFloor;
  return out;
}
/** E 门坐标唯一来源：地图 POI API（orientaLoadPekPoiGateAnchorsSync_） */
function orientaGetPekGateCoordMap_() {
  return orientaLoadPekPoiGateAnchorsSync_();
}
function orientaLookupPekEGateLngLat_(gateNorm, preferFloor) {
  var g = orientaNormPekPoiKey_(gateNorm) || orientaNormalizeGate_(gateNorm);
  if (!g) return null;
  var pf = orientaPekFloorStorageKey_(preferFloor);
  var byFl = __orientaPekPoiByFloorCache_;
  if (byFl && byFl[g]) {
    if (pf && byFl[g][pf]) return [Number(byFl[g][pf][0]), Number(byFl[g][pf][1])];
    if (pf === 'L2' && byFl[g].L2) return [Number(byFl[g].L2[0]), Number(byFl[g].L2[1])];
    if (pf === 'L3' && byFl[g].L3) return [Number(byFl[g].L3[0]), Number(byFl[g].L3[1])];
  }
  var map = orientaGetPekGateCoordMap_();
  var c = map[g];
  if (c && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) return [Number(c[0]), Number(c[1])];
  return null;
}
function orientaPekIsEGateKey_(g) {
  var s = String(g || "").trim().toUpperCase();
  if (!/^E\d{1,2}$/.test(s)) return false;
  return !!orientaLookupPekEGateLngLat_(s);
}
function orientaHaversineMetersPek_(lng1, lat1, lng2, lat2) {
  var R = 6371000;
  var p1 = (lat1 * Math.PI) / 180;
  var p2 = (lat2 * Math.PI) / 180;
  var dl = ((lng2 - lng1) * Math.PI) / 180;
  var dp = p2 - p1;
  var a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
/** 沿 E36→E20 指廊主轴排序的 E 门列表（用于链式边 + 与 CSV 相邻门边合并） */
function orientaPekSpineGatesOrdered_() {
  var map = orientaGetPekGateCoordMap_();
  var a = map.E36;
  var b = map.E20;
  if (!a || !b) return [];
  var ax = a[0],
    ay = a[1],
    bx = b[0],
    by = b[1];
  var vx = bx - ax,
    vy = by - ay;
  var vlen2 = vx * vx + vy * vy;
  if (vlen2 < 1e-18) return [];
  var gates = [];
  for (var k in map) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
    if (!/^E\d{1,2}$/.test(k)) continue;
    gates.push(k);
  }
  gates.sort(function (ga, gb) {
    var pa = map[ga];
    var pb = map[gb];
    var ta = ((pa[0] - ax) * vx + (pa[1] - ay) * vy) / vlen2;
    var tb = ((pb[0] - ax) * vx + (pb[1] - ay) * vy) / vlen2;
    return ta - tb;
  });
  return gates;
}
function orientaPekAddUndirectedEdge_(adj, u, v, w) {
  if (u === v || !Number.isFinite(w) || w < 0) return;
  if (!adj[u]) adj[u] = [];
  if (!adj[v]) adj[v] = [];
  function merge(list, tgt, wt) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].to === tgt) {
        if (wt < list[i].w) list[i].w = wt;
        return;
      }
    }
    list.push({ to: tgt, w: wt });
  }
  merge(adj[u], v, w);
  merge(adj[v], u, w);
}
/** 指廊链 + PEK_gate_timestamp 相邻 E 门边 → 无向图；Dijkstra 最短路径（米权） */
function orientaBuildPekGateAdjacency_() {
  var adj = Object.create(null);
  var spine = orientaPekSpineGatesOrdered_();
  var si;
  for (si = 0; si + 1 < spine.length; si++) {
    var g0 = spine[si],
      g1 = spine[si + 1];
    var c0 = orientaLookupPekEGateLngLat_(g0);
    var c1 = orientaLookupPekEGateLngLat_(g1);
    if (!c0 || !c1) continue;
    var w = orientaHaversineMetersPek_(c0[0], c0[1], c1[0], c1[1]);
    orientaPekAddUndirectedEdge_(adj, g0, g1, w);
  }
  if (typeof __pekRows !== "undefined" && __pekRows && __pekRows.length) {
    for (var ri = 0; ri + 1 < __pekRows.length; ri++) {
      var ga = orientaNormalizeGate_(__pekRows[ri].gate);
      var gb = orientaNormalizeGate_(__pekRows[ri + 1].gate);
      if (!orientaPekIsEGateKey_(ga) || !orientaPekIsEGateKey_(gb) || ga === gb) continue;
      var ca = orientaLookupPekEGateLngLat_(ga);
      var cb = orientaLookupPekEGateLngLat_(gb);
      if (!ca || !cb) continue;
      var ww = orientaHaversineMetersPek_(ca[0], ca[1], cb[0], cb[1]);
      orientaPekAddUndirectedEdge_(adj, ga, gb, ww);
    }
  }
  return adj;
}
function orientaDijkstraPekGates_(adj, start, goal) {
  if (start === goal) return [start];
  var dist = Object.create(null);
  var prev = Object.create(null);
  var nodes = Object.keys(adj);
  if (nodes.indexOf(start) < 0 || nodes.indexOf(goal) < 0) return null;
  var INF = 1e30;
  var ni;
  for (ni = 0; ni < nodes.length; ni++) dist[nodes[ni]] = INF;
  dist[start] = 0;
  var visited = Object.create(null);
  var count;
  for (count = 0; count < nodes.length; count++) {
    var u = null,
      best = INF;
    for (ni = 0; ni < nodes.length; ni++) {
      var cand = nodes[ni];
      if (visited[cand]) continue;
      if (dist[cand] < best) {
        best = dist[cand];
        u = cand;
      }
    }
    if (u == null || best >= INF) break;
    visited[u] = 1;
    if (u === goal) break;
    var outs = adj[u] || [];
    for (var ei = 0; ei < outs.length; ei++) {
      var e = outs[ei];
      var alt = dist[u] + e.w;
      if (alt < dist[e.to]) {
        dist[e.to] = alt;
        prev[e.to] = u;
      }
    }
  }
  if (!(dist[goal] < INF)) return null;
  var pathRev = [goal];
  var cur = goal;
  while (cur !== start && prev[cur] != null) {
    cur = prev[cur];
    pathRev.push(cur);
  }
  if (cur !== start) return null;
  return pathRev.reverse();
}
/** Map route [lng,lat]：T3E E 门图上 Dijkstra（坐标来自地图 POI 标注） */
function orientaBuildPekPathLonLatFromLandmarks_() {
  if (window.__ROUTESITE_HUB__ !== 'PEK') return null;
  var fromG, toG;
  if (typeof __pekClip !== 'undefined' && __pekClip && __pekClip.fromGate && __pekClip.toGate) {
    fromG = __pekClip.fromGate;
    toG = __pekClip.toGate;
  } else if (typeof __pekRows !== 'undefined' && __pekRows && __pekRows.length) {
    fromG = __pekRows[0].gate;
    toG = __pekRows[__pekRows.length - 1].gate;
  } else {
    var __drg = orientaRouteSiteCfg_().defaultRouteGates || { from: 'E16', to: 'E19' };
    fromG = __drg.from;
    toG = __drg.to;
  }
  fromG = orientaNormalizeGate_(fromG);
  toG = orientaNormalizeGate_(toG);
  if (orientaPekIsEGateKey_(fromG) && orientaPekIsEGateKey_(toG)) {
    var adj = orientaBuildPekGateAdjacency_();
    var seq = orientaDijkstraPekGates_(adj, fromG, toG);
    if (seq && seq.length >= 2) {
      var out = [];
      var preferFl =
        typeof __orientaPekClipFloorMode_ !== 'undefined' && __orientaPekClipFloorMode_ === 'L2_ONLY'
          ? 'L2'
          : typeof __orientaPekClipFloorMode_ !== 'undefined' && __orientaPekClipFloorMode_ === 'L3_ONLY'
            ? 'L3'
            : null;
      for (var si = 0; si < seq.length; si++) {
        var c = orientaLookupPekEGateLngLat_(seq[si], preferFl);
        if (c) out.push([c[0], c[1]]);
      }
      if (out.length >= 2) return out;
    }
  }
  return null;
}
var PATH_LONLAT_PEK_FALLBACK = (orientaRouteSiteCfg_().pathLonLatFallback) || [[116.610013, 40.079188], [116.609573, 40.07885], [116.608943, 40.078642], [116.608302, 40.07826], [116.607674, 40.077897]] || [];
if (window.__ROUTESITE_HUB__ === "PEK") {
  try {
    orientaLoadPekPoiGateAnchorsSync_();
  } catch (ePoiPreload) {}
}
var PATH_LONLAT_PEK = orientaBuildPekPathLonLatFromLandmarks_() || PATH_LONLAT_PEK_FALLBACK;
(function orientaVideoErrorHint_(){
  var v = document.getElementById('vid');
  if (!v) return;
  var missingTimer = null;
  function clearMissingOverlay() {
    var wrap = document.getElementById('videoWrap');
    if (!wrap) return;
    var d = wrap.querySelector('.orienta-video-missing');
    if (d && d.parentNode) d.parentNode.removeChild(d);
    v.removeAttribute('data-orienta-shown-missing');
  }
  function clearMissingTimer() {
    if (missingTimer) { clearTimeout(missingTimer); missingTimer = null; }
    // If media became playable again, clear stale overlay from previous transient errors.
    if (v.readyState >= 2 && !v.error) clearMissingOverlay();
  }
  function scheduleMissingOverlay() {
    clearMissingTimer();
    missingTimer = setTimeout(function(){
      missingTimer = null;
      if (!v.error) return;
      if (v.readyState >= 2) return;
      if (v.getAttribute('data-orienta-shown-missing') === '1') return;
      v.setAttribute('data-orienta-shown-missing', '1');
      var wrap = document.getElementById('videoWrap');
      if (!wrap || wrap.querySelector('.orienta-video-missing')) return;
      var mainFile = ORIENTA_PEK_MERGED_FROM_CSV_BASENAME + '（由 CSV + concat 脚本生成）';
      var tried = String(v.currentSrc || v.src || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var pekList =
        '<li>按 <code>PEK_gate_timestamp.csv</code> 裁切并合并：在 <code>orienta_v3</code> 目录执行 <code>python3 scripts/concat_pek_video_from_csv.py ...</code>，生成 <code>' +
          ORIENTA_PEK_MERGED_FROM_CSV_BASENAME +
          '</code>；ffmpeg 只读分段素材、不写回原文件。</li>' +
        '<li>临时换片：<code>?pekVideo=文件名.mp4</code>（与 index.html 同目录）。</li>';
      var renderBlock =
        '<p style="margin:0 0 6px;font-weight:600">Render</p>' +
        '<ul style="margin:0;padding-left:1.25em">' +
        '<li>设置 <code>PEK_VIDEO_URL</code> 为已合并母带的直链（构建时写入 <code>' +
          ORIENTA_PEK_MERGED_FROM_CSV_BASENAME +
          '</code>；可用 <code>PEK_MERGED_OUT</code> 改路径）。</li>' +
        '<li><code>Root Directory</code> 留空（仓库根）；Build：<code>bash scripts/render-build.sh</code>。</li>' +
        '</ul>';
      var d = document.createElement('div');
      d.className = 'orienta-video-missing';
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,15,18,0.92);color:#f5f5f7;font:15px/1.55 system-ui,sans-serif;z-index:40;';
      d.innerHTML =
        '<div style="max-width:36rem;margin:0 auto;text-align:left">' +
        '<p style="margin:0 0 10px;text-align:center;font-weight:600">视频无法加载（404、路径大小写或编码）</p>' +
        '<p style="margin:0 0 14px;font-size:13px;opacity:.92;word-break:break-all"><code>' +
        tried +
        '</code></p>' +
        '<p style="margin:0 0 6px;font-weight:600">本地</p>' +
        '<ul style="margin:0 0 14px;padding-left:1.25em">' +
        '<li>把 <code>' +
        mainFile +
        '</code> 放到 <code>apps/dashboard/public/route_site/</code>，与 <code>index.html</code> 同级；Linux 注意大小写。</li>' +
        pekList +
        '</ul>' +
        renderBlock +
        '</div>';
      wrap.appendChild(d);
    }, 3500);
  }
  v.addEventListener('error', scheduleMissingOverlay);
  v.addEventListener('loadeddata', clearMissingTimer);
  v.addEventListener('canplay', clearMissingTimer);
  v.addEventListener('playing', clearMissingTimer);
})();
function buildGateToSegmentTimeMap() {
  var m = {};
  (ROUTE_GATE_SEGMENTS || []).forEach(function(r){
    var k = (r.gate || '').toString().trim().toUpperCase();
    if (k) m[k] = Number(r.segmentTime);
  });
  return m;
}

