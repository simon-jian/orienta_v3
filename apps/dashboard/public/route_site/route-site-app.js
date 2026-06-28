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
  out.push(
    'PEK_T3E_F3_E24_E36.mp4',
    'PEK_T3E_F3_E32_Security_Checkpoint2.mp4',
    'PEK_T3E_Security_Checkpoint_2_F3_Escalator_2_F2.mp4',
    'PEK_T3E_F3_E32_Escalator_2.mp4',
    'PEK_T3E_Escalator_2_F3_F2.mp4',
    'PEK_T3E_F2_Escalator_2_E24.mp4'
  );
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
    var paxAlias = { DA8X3: "TX1", DB5K7: "TX3", DC2N9: "TX2" };
    var pax = paxAlias[(rawPax || '').toUpperCase()] || rawPax;
    var demoGateByPax = {
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

// ---------- data ----------
const PATH_LONLAT = PATH_LONLAT_PEK;
/** 室内图 BFS 完成后 postMessage 写入，与 PATH_LONLAT 同为 [lng,lat][] */
window.__ORIENTA_PATH_LONLAT_FROM_MAP__ = null;
/** 与 path 等长：POI floor（F3/L3…），用于按层切分子轨迹（对齐 PEK_gate_timestamp.csv 的 F3/F2） */
window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__ = null;
/** 当前内嵌 airport-map 展示层（L3/L2/L1）；轨迹 POST / WS / OL 折线只发本层子路径，不把 F3+F2 叠成一条 */
window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ = "L3";
function orientaGetPathLonLat_() {
  var o = window.__ORIENTA_PATH_LONLAT_FROM_MAP__;
  return o && o.length >= 2 ? o : PATH_LONLAT;
}
function orientaPathLonLatDigest_(pl) {
  if (!pl || pl.length < 2) return "0";
  var h = 5381 >>> 0;
  h = (((h << 5) + h) + pl.length) >>> 0;
  for (var i = 0; i < pl.length; i++) {
    var c = pl[i];
    var x = Math.round(Number(c[0]) * 1e6);
    var y = Math.round(Number(c[1]) * 1e6);
    h = (((h << 5) + h) + x) >>> 0;
    h = (((h << 5) + h) + y) >>> 0;
  }
  return String(h >>> 0);
}
function orientaFloorsDigest_(floors, n) {
  if (!floors || !n || floors.length !== n) return "f0";
  var h = 5381 >>> 0;
  for (var i = 0; i < floors.length; i++) {
    var t = String(floors[i] != null ? floors[i] : "").trim();
    for (var j = 0; j < t.length; j++) h = (((h << 5) + h) + t.charCodeAt(j)) >>> 0;
    h = (((h << 5) + h) + 10) >>> 0;
  }
  return String(h >>> 0);
}
/** Fingerprint route + floor inputs so we ignore transient path swaps while map data settles (stops dot flicker). */
function orientaMapPathStabilityKey_() {
  var pl = orientaGetPathLonLat_();
  var n = pl ? pl.length : 0;
  var floors = window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__;
  var fn = floors && n && floors.length === n ? n : 0;
  var digP = orientaPathLonLatDigest_(pl);
  var digF = orientaFloorsDigest_(floors, n);
  var disp = String(window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ || "").trim();
  var sw =
    typeof __pekFloorSwitchTimeFrac !== "undefined" && __pekFloorSwitchTimeFrac != null
      ? String(__pekFloorSwitchTimeFrac)
      : "";
  var src = window.__ORIENTA_PATH_LONLAT_FROM_MAP__ && window.__ORIENTA_PATH_LONLAT_FROM_MAP__.length >= 2 ? "m" : "d";
  return src + ":" + n + ":" + fn + ":" + digP + ":" + digF + ":" + disp + ":" + sw;
}
var __orientaPathStabKey_ = null;
var __orientaPathStabCount_ = 0;
var __orientaPathStabPrevSrc_ = null;
var __orientaLatchedDisplayMapSplit_ = null;
var __orientaLatchedDisplayPathUsed_ = null;
var __orientaLatchedDisplayFloor_ = null;
/**
 * While indoor lon/lat path is in use: hold last good dot/line split until the same stability key
 * holds for 2 consecutive drawPeoplePage frames (new key → keep previous position until settled).
 */
function orientaApplyDisplayMapSplitStability_(mapSplit, pathUsed) {
  if (!window.__ORIENTA_PATH_LONLAT_FROM_MAP__ || !window.__ORIENTA_PATH_LONLAT_FROM_MAP__.length || window.__ORIENTA_PATH_LONLAT_FROM_MAP__.length < 2) {
    __orientaPathStabPrevSrc_ = "d";
    if (mapSplit && orientaCoordFiniteLngLat_(mapSplit.coord)) {
      __orientaLatchedDisplayMapSplit_ = mapSplit;
      __orientaLatchedDisplayPathUsed_ = pathUsed;
    }
    return { ms: mapSplit, pathUsed: pathUsed };
  }
  var key = orientaMapPathStabilityKey_();
  var srcTag = key.length ? key.split(":")[0] : "";
  if (__orientaPathStabPrevSrc_ != null && __orientaPathStabPrevSrc_ !== srcTag) {
    __orientaLatchedDisplayMapSplit_ = null;
    __orientaLatchedDisplayPathUsed_ = null;
  }
  __orientaPathStabPrevSrc_ = srcTag;
  var dispNow = String(window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ || __orientaLastPostedMapFloor || "").trim();
  if (__orientaLatchedDisplayFloor_ != null && dispNow && __orientaLatchedDisplayFloor_ !== dispNow) {
    __orientaLatchedDisplayMapSplit_ = null;
    __orientaLatchedDisplayPathUsed_ = null;
    __orientaPathStabCount_ = 0;
  }
  __orientaLatchedDisplayFloor_ = dispNow || __orientaLatchedDisplayFloor_;
  if (key !== __orientaPathStabKey_) {
    __orientaPathStabKey_ = key;
    __orientaPathStabCount_ = 0;
  }
  __orientaPathStabCount_++;
  var stable = __orientaPathStabCount_ >= 2;
  if (!stable && __orientaLatchedDisplayMapSplit_ && orientaCoordFiniteLngLat_(__orientaLatchedDisplayMapSplit_.coord)) {
    return { ms: __orientaLatchedDisplayMapSplit_, pathUsed: __orientaLatchedDisplayPathUsed_ };
  }
  if (stable && mapSplit && orientaCoordFiniteLngLat_(mapSplit.coord)) {
    __orientaLatchedDisplayMapSplit_ = mapSplit;
    __orientaLatchedDisplayPathUsed_ = pathUsed;
  }
  return { ms: mapSplit, pathUsed: pathUsed };
}
function orientaCoordFiniteLngLat_(c) {
  return !!(c && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
}
/** Perpendicular distance in EPSG:3857 (≈ meters) from lng/lat point to polyline (for trajectory sanity checks). */
function orientaDistPointToSegmentXY_(p, a, b) {
  var vx = b[0] - a[0];
  var vy = b[1] - a[1];
  var c2 = vx * vx + vy * vy;
  if (c2 < 1e-24) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / c2));
  var px = a[0] + t * vx;
  var py = a[1] + t * vy;
  return Math.hypot(p[0] - px, p[1] - py);
}
function orientaDistPointToPath3857m_(lngLat, pathLngLat) {
  if (!lngLat || !pathLngLat || pathLngLat.length < 2 || typeof ol === "undefined") return null;
  try {
    var proj = ol.proj.get("EPSG:3857");
    var p = ol.proj.fromLonLat(lngLat, proj);
    var best = Infinity;
    for (var i = 0; i < pathLngLat.length - 1; i++) {
      var a = ol.proj.fromLonLat(pathLngLat[i], proj);
      var b = ol.proj.fromLonLat(pathLngLat[i + 1], proj);
      var d = orientaDistPointToSegmentXY_(p, a, b);
      if (d < best) best = d;
    }
    return best;
  } catch (e) {
    return null;
  }
}
/**
 * Project lon/lat point onto polyline in EPSG:3857; returns arc-length s (meters) and distance (meters).
 * @returns {{ distM:number, sM:number, projLngLat:[number,number], segIdx:number, t:number } | null}
 */
function orientaProjectPointToPath3857_(lngLat, pathLngLat) {
  if (!lngLat || !pathLngLat || pathLngLat.length < 2 || typeof ol === "undefined") return null;
  try {
    var proj = ol.proj.get("EPSG:3857");
    var p = ol.proj.fromLonLat(lngLat, proj);
    var best = { distM: Infinity, sM: 0, segIdx: 0, t: 0, projXY: null };
    var acc = 0;
    for (var i = 0; i < pathLngLat.length - 1; i++) {
      var aLL = pathLngLat[i];
      var bLL = pathLngLat[i + 1];
      var a = ol.proj.fromLonLat(aLL, proj);
      var b = ol.proj.fromLonLat(bLL, proj);
      var vx = b[0] - a[0];
      var vy = b[1] - a[1];
      var c2 = vx * vx + vy * vy;
      var t = 0;
      if (c2 > 1e-24) t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / c2));
      var px = a[0] + t * vx;
      var py = a[1] + t * vy;
      var d = Math.hypot(p[0] - px, p[1] - py);
      var segLen = Math.hypot(vx, vy);
      if (d < best.distM) {
        best.distM = d;
        best.sM = acc + t * segLen;
        best.segIdx = i;
        best.t = t;
        best.projXY = [px, py];
      }
      acc += segLen;
    }
    if (!isFinite(best.distM) || !isFinite(best.sM) || !best.projXY) return null;
    var projLL = ol.proj.toLonLat(best.projXY, proj);
    return { distM: best.distM, sM: best.sM, projLngLat: [projLL[0], projLL[1]], segIdx: best.segIdx, t: best.t };
  } catch (e) {
    return null;
  }
}
function orientaBearingDeg_(aLngLat, bLngLat) {
  try {
    var lon1 = (aLngLat[0] * Math.PI) / 180;
    var lon2 = (bLngLat[0] * Math.PI) / 180;
    var lat1 = (aLngLat[1] * Math.PI) / 180;
    var lat2 = (bLngLat[1] * Math.PI) / 180;
    var dLon = lon2 - lon1;
    var y = Math.sin(dLon) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    var brng = (Math.atan2(y, x) * 180) / Math.PI;
    brng = (brng + 360) % 360;
    return brng;
  } catch (e) {
    return 0;
  }
}
function orientaHaversineM_(a, b) {
  var R = 6371000;
  var dLat = ((b[1] - a[1]) * Math.PI) / 180;
  var dLon = ((b[0] - a[0]) * Math.PI) / 180;
  var p1 = (a[1] * Math.PI) / 180;
  var p2 = (b[1] * Math.PI) / 180;
  var h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}
var __orientaTouristDbgPrevCoord = null;
var __orientaTouristDbgFrame = 0;
/** Ring buffer of recent tourist snapshots (enough ~60s at ~20fps cap) to inspect jumps in DevTools. */
var __orientaTouristMapHistoryRing = [];
var ORIENTA_TOURIST_MAP_HISTORY_MAX = 3600;
function orientaAppendTouristMapHistory_(entry) {
  __orientaTouristMapHistoryRing.push(entry);
  if (__orientaTouristMapHistoryRing.length > ORIENTA_TOURIST_MAP_HISTORY_MAX) {
    __orientaTouristMapHistoryRing.shift();
  }
  try {
    window.__ORIENTA_TOURIST_MAP_POS_HISTORY__ = __orientaTouristMapHistoryRing;
  } catch (eH) {}
  try {
    if (typeof window.orientaPdrRecorderHook === "function") {
      window.orientaPdrRecorderHook("tourist_map", entry);
    }
  } catch (eRec) {}
}
function orientaClearTouristMapHistory_() {
  __orientaTouristMapHistoryRing.length = 0;
  try {
    window.__ORIENTA_TOURIST_MAP_POS_HISTORY__ = __orientaTouristMapHistoryRing;
  } catch (eC) {}
}
/** Console + window snapshot; add ?orientaMapPosLog=1 to log anomalies & every ~45 frames. */
function orientaTouristMapDebugEnabled_() {
  try {
    var sp = new URLSearchParams(location.search);
    return /^(1|true|yes)$/i.test(
      String(sp.get("orientaMapPosLog") || sp.get("orientaTouristDebug") || sp.get("touristPosLog") || "").trim()
    );
  } catch (e) {
    return false;
  }
}
function orientaPublishTouristMapDebug_(base, mapSplit, pathUsedForMap, scrubbing) {
  var wallMs = Date.now();
  var perfMs = typeof performance !== "undefined" ? performance.now() : 0;
  var vt = typeof vid !== "undefined" && vid ? vid.currentTime : null;
  if (!mapSplit || !orientaCoordFiniteLngLat_(mapSplit.coord)) {
    try {
      window.__ORIENTA_LAST_TOURIST_MAP_POS__ = null;
      orientaAppendTouristMapHistory_({
        wallMs: wallMs,
        perfMs: perfMs,
        missingSplit: true,
        base: base,
        scrubbing: !!scrubbing,
        videoTime: vt,
      });
    } catch (e0) {}
    return;
  }
  var c = mapSplit.coord;
  var offM = null;
  if (pathUsedForMap && pathUsedForMap.length >= 2) offM = orientaDistPointToPath3857m_(c, pathUsedForMap);
  var jumpM = null;
  if (__orientaTouristDbgPrevCoord) jumpM = orientaHaversineM_(__orientaTouristDbgPrevCoord, c);
  __orientaTouristDbgPrevCoord = [c[0], c[1]];
  var pdrOn =
    orientaPdrOverridesVideoRouteDot_() && window.__ORIENTA_PDR__ && window.__ORIENTA_PDR__.active;
  var row = {
    lng: c[0],
    lat: c[1],
    base: base,
    videoTime: vt,
    scrubbing: !!scrubbing,
    pathVerts: pathUsedForMap ? pathUsedForMap.length : null,
    offPathMeters3857: offM,
    jumpFromPrevM: jumpM,
    pdrOverridesDot: !!pdrOn,
  };
  try {
    window.__ORIENTA_LAST_TOURIST_MAP_POS__ = row;
  } catch (e1) {}
  orientaAppendTouristMapHistory_(
    Object.assign({ wallMs: wallMs, perfMs: perfMs }, row)
  );
  if (!orientaTouristMapDebugEnabled_()) return;
  __orientaTouristDbgFrame++;
  var offSpike = offM != null && offM > 2.5;
  var jumpSpike = jumpM != null && jumpM > 40 && !scrubbing;
  if (offSpike || jumpSpike || __orientaTouristDbgFrame % 45 === 1) {
    try {
      console[offSpike || jumpSpike ? "warn" : "log"](
        offSpike || jumpSpike ? "[tourist-map] anomaly" : "[tourist-map]",
        row
      );
    } catch (e2) {}
  }
}
function orientaNormFloorTag_(s) {
  var t = String(s || "")
    .trim()
    .toUpperCase();
  if (t === "F3" || t === "L3") return "L3";
  if (t === "F2" || t === "L2") return "L2";
  if (t === "F1" || t === "L1") return "L1";
  if (t === "B1") return "B1";
  return t || "";
}
/** 连续同层：只保留 floor 与当前展示层一致的一段折线（用于轨迹与底图，不混层） */
function orientaSlicePathLonLatByFloorTag_(path, floors, displayFloorRaw) {
  if (!path || path.length < 2 || !floors || floors.length !== path.length) return null;
  var want = orientaNormFloorTag_(displayFloorRaw);
  if (!want) return null;
  var tags = orientaInferFloorTagsForSplit_(floors);
  var n = path.length;
  var i0 = -1;
  for (var i = 0; i < n; i++) {
    if (tags[i] === want) {
      i0 = i;
      break;
    }
  }
  if (i0 < 0) return null;
  var i1 = i0;
  for (var j = i0 + 1; j < n; j++) {
    if (tags[j] === want) i1 = j;
    else break;
  }
  if (i1 - i0 < 1) return null;
  return path.slice(i0, i1 + 1);
}
/** 上报 / 父页转发 / OL 底图用的折线：仅当前室内展示层；无 per-point floor 时退回全路径 */
function orientaPathLonLatForCurrentIndoorFloor_() {
  var pl = window.__ORIENTA_PATH_LONLAT_FROM_MAP__;
  if (!pl || pl.length < 2) return null;
  var floors = window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__;
  var disp = String(window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ || "").trim();
  if (!disp && typeof __orientaLastPostedMapFloor !== "undefined" && __orientaLastPostedMapFloor)
    disp = String(__orientaLastPostedMapFloor).trim();
  if (!disp) disp = "L3";
  if (!floors || floors.length !== pl.length) return pl.slice();
  var sliced = orientaSlicePathLonLatByFloorTag_(pl, floors, disp);
  return sliced && sliced.length >= 2 ? sliced : pl.slice();
}
/**
 * 将整段视频的 base(0..1) 按「全路径弧长」映射到第一条 floor==disp 的连续子段上的 u(0..1)：
 * 尚未走到该层为 0，已离开该层为 1（与单层轨迹线一致；无 per-floor 时退回 base）。
 */
function orientaGlobalBaseToUOnFirstFloorRun_(path, floors, base, displayFloorRaw) {
  if (!path || path.length < 2 || !floors || floors.length !== path.length) {
    return Math.max(0, Math.min(1, base));
  }
  var want = orientaNormFloorTag_(displayFloorRaw);
  if (!want) return Math.max(0, Math.min(1, base));
  var tags = orientaInferFloorTagsForSplit_(floors);
  var n = path.length;
  var runs = [];
  var ri = 0;
  while (ri < n) {
    var rj = ri;
    while (rj + 1 < n && tags[rj + 1] === tags[ri]) rj++;
    var sub = path.slice(ri, rj + 1);
    runs.push({ i0: ri, i1: rj, tag: orientaNormFloorTag_(tags[ri]), len: totalLength(sub) });
    ri = rj + 1;
  }
  var targetRun = null;
  for (var r = 0; r < runs.length; r++) {
    if (runs[r].tag === want) {
      targetRun = runs[r];
      break;
    }
  }
  if (!targetRun || targetRun.len < 1e-12) return Math.max(0, Math.min(1, base));
  var prefix = 0;
  for (var r2 = 0; r2 < runs.length; r2++) {
    if (runs[r2] === targetRun) break;
    prefix += runs[r2].len;
  }
  var fullLen = 0;
  for (var r3 = 0; r3 < runs.length; r3++) fullLen += runs[r3].len;
  if (fullLen < 1e-12) return 0;
  var dist = Math.max(0, Math.min(1, base)) * fullLen;
  if (dist <= prefix) return 0;
  if (dist >= prefix + targetRun.len) return 1;
  return (dist - prefix) / targetRun.len;
}
/** 首条 L2 点之前为 F3 子路径；从首条 L2 起为 F2 子路径（含 F2 Escalator_2 → …→E25） */
/** Carry last non-empty floor tag forward so sparse POI floor props still split L3/L2. */
function orientaInferFloorTagsForSplit_(floors) {
  if (!floors || !floors.length) return [];
  var tags = [];
  var last = "";
  for (var i = 0; i < floors.length; i++) {
    var t = orientaNormFloorTag_(floors[i]);
    if (t) last = t;
    tags.push(last);
  }
  return tags;
}
function orientaSplitNavPathByIndoorFloors_(path, floors) {
  if (!path || !floors || path.length < 2 || floors.length !== path.length) return null;
  var tags = orientaInferFloorTagsForSplit_(floors);
  var iFirstL2 = -1;
  for (var j = 0; j < tags.length; j++) {
    if (tags[j] === "L2") {
      iFirstL2 = j;
      break;
    }
  }
  if (iFirstL2 < 0) return { l3: path.slice(), l2: null, iFirstL2: -1 };
  var l3 = iFirstL2 >= 2 ? path.slice(0, iFirstL2) : null;
  if (l3 && l3.length < 2) l3 = null;
  var l2Start = iFirstL2 > 0 ? iFirstL2 - 1 : iFirstL2;
  var l2 = path.slice(l2Start);
  if (l2.length < 2) l2 = null;
  return { l3: l3, l2: l2, iFirstL2: iFirstL2 };
}
/** L3/L2 subpath + video-time u (not full-path arc) — used when gNav path missing or as fallback. */
function orientaMapMsFromFloorVideoSlice_(path, floors, base, sw) {
  if (!path || path.length < 2 || !floors || floors.length !== path.length) return null;
  if (sw == null || !Number.isFinite(sw) || sw <= 0 || sw >= 1) return null;
  var g = orientaMapSegAndUForIndoorFloors_(path, floors, base, sw);
  if (g && g.seg && g.seg.length >= 2) {
    return {
      ms: orientaMapSplitFromPathProgress_(g.seg, g.u, DOT_START_OFFSET, DOT_END_OFFSET),
      pathUsed: g.seg,
    };
  }
  var wantL3 = orientaPekVideoWantL3_(base, sw);
  var seg = orientaSlicePathLonLatByFloorTag_(path, floors, wantL3 ? "L3" : "L2");
  if (!seg || seg.length < 2) return null;
  var u = wantL3
    ? Math.min(1, Math.max(0, base / sw))
    : Math.min(1, Math.max(0, (base - sw) / Math.max(1e-9, 1 - sw)));
  return {
    ms: orientaMapSplitFromPathProgress_(seg, u, DOT_START_OFFSET, DOT_END_OFFSET),
    pathUsed: seg,
  };
}
/** 与 __pekFloorSwitchTimeFrac（CSV 首条 F2 时刻）一起：当前层子折线 + 0..1 弧长参数 */
function orientaMapSegAndUForIndoorFloors_(path, floors, base, sw) {
  if (sw == null || !Number.isFinite(sw) || sw <= 0 || sw >= 1) return null;
  var split = orientaSplitNavPathByIndoorFloors_(path, floors);
  if (!split || split.iFirstL2 < 0) return null;
  var wantL3 = orientaPekVideoWantL3_(base, sw);
  var seg = wantL3 ? split.l3 : split.l2;
  if (!seg || seg.length < 2) return null;
  var u = wantL3
    ? Math.min(1, Math.max(0, base / sw))
    : Math.min(1, Math.max(0, (base - sw) / Math.max(1e-9, 1 - sw)));
  return { seg: seg, u: u, wantL3: wantL3 };
}
function orientaApplyNavPathLonLatFromMap_(path, pointFloors, pathSteps) {
  if (!path || !Array.isArray(path) || path.length < 2) return;
  var out = [];
  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    var lng;
    var lat;
    if (Array.isArray(p) && p.length >= 2) {
      lng = Number(p[0]);
      lat = Number(p[1]);
    } else if (p && typeof p === "object") {
      lng = Number(p.lng != null ? p.lng : p[0]);
      lat = Number(p.lat != null ? p.lat : p[1]);
    } else continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push([lng, lat]);
  }
  if (out.length < 2) return;
  window.__ORIENTA_PATH_LONLAT_FROM_MAP__ = out;
  window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__ = null;
  if (pointFloors && Array.isArray(pointFloors) && pointFloors.length) {
    var pf = pointFloors.map(function (x) {
      return String(x != null ? x : "").trim();
    });
    if (pf.length !== out.length) {
      if (pf.length > out.length) {
        pf = pf.slice(0, out.length);
      } else if (pf.length > 0) {
        var padTag = pf[pf.length - 1];
        while (pf.length < out.length) pf.push(padTag);
      } else {
        pf = null;
      }
    }
    if (pf && pf.length === out.length) {
      window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__ = pf;
      try {
        var f0 = "";
        for (var fi = 0; fi < window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__.length; fi++) {
          f0 = orientaNormFloorTag_(window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__[fi]);
          if (f0) break;
        }
        if (f0) window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ = f0;
      } catch (eInitF) {}
    }
  }
  try {
    if (pathSteps && Array.isArray(pathSteps)) {
      window.__ORIENTA_NAV_PATH_STEPS__ = pathSteps;
      window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = pathSteps.filter(function (x) {
        return x && x.category === "waypoint";
      });
      __orientaMapPoiCheckpointTriggered_.clear();
      __orientaPdrNextPoiIdx_ = 0;
    } else {
      window.__ORIENTA_NAV_PATH_STEPS__ = [];
      window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__ = [];
    }
  } catch (eG) {}
  var logNav = false;
  try {
    var _rsp = new URLSearchParams(window.location.search);
    logNav =
      /^(1|true|yes)$/i.test(String(_rsp.get("orientaNavPathLog") || "").trim()) ||
      /^(1|true|yes)$/i.test(String(_rsp.get("navPathLog") || "").trim()) ||
      /^(1|true|yes)$/i.test(String(_rsp.get("orientaDebug") || _rsp.get("debug") || "").trim());
  } catch (eU) {}
  if (logNav && window.__ORIENTA_NAV_PATH_STEPS__ && window.__ORIENTA_NAV_PATH_STEPS__.length) {
    try {
      console.info("[route_site] BFS 全路径顶点 → window.__ORIENTA_NAV_PATH_STEPS__；仅路径点 → __ORIENTA_NAV_PATH_WAYPOINTS_ONLY__");
      console.table(window.__ORIENTA_NAV_PATH_STEPS__);
      if (window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__.length) console.table(window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__);
    } catch (eT) {}
  }
  try {
    if (typeof orientaRouteSiteDebugLog_ === "function") {
      orientaRouteSiteDebugLog_("[nav-path] from indoor map " + out.length + " pts", false);
    }
  } catch (eL) {}
  orientaRefreshPeopleMapPathGeometry_();
}
/** 室内路径到达后刷新 OpenLayers 底图上的 full 折线（若已初始化） */
function orientaRefreshPeopleMapPathGeometry_() {
  var pl = orientaPathLonLatForCurrentIndoorFloor_();
  if (!pl || pl.length < 2) pl = orientaGetPathLonLat_();
  if (!pl || pl.length < 2 || typeof ol === "undefined") return;
  try {
    if (peoplePathSource && mapPeople) {
      var feats = peoplePathSource.getFeatures();
      for (var fi = feats.length - 1; fi >= 0; fi--) {
        if (feats[fi].get("type") === "full") peoplePathSource.removeFeature(feats[fi]);
      }
      try {
        if (__orientaOlPastFeature) {
          peoplePathSource.removeFeature(__orientaOlPastFeature);
          __orientaOlPastFeature = null;
        }
        if (__orientaOlFutureFeature) {
          peoplePathSource.removeFeature(__orientaOlFutureFeature);
          __orientaOlFutureFeature = null;
        }
      } catch (eSplit) {}
      var fullNew = new ol.Feature({
        geometry: new ol.geom.LineString(pl.map(function (c) { return ol.proj.fromLonLat(c); })),
      });
      fullNew.set("type", "full");
      peoplePathSource.addFeature(fullNew);
      var coords = pl.map(function (c) { return ol.proj.fromLonLat(c); });
      var xmin = Infinity;
      var ymin = Infinity;
      var xmax = -Infinity;
      var ymax = -Infinity;
      for (var ci = 0; ci < coords.length; ci++) {
        var x = coords[ci][0];
        var y = coords[ci][1];
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
      if (xmin < xmax && ymin < ymax) {
        mapPeople.getView().fit([xmin, ymin, xmax, ymax], { padding: [24, 24, 24, 24], maxZoom: 18, duration: 200 });
      }
      __orientaOlHideFullRoute = false;
    }
  } catch (eR) {}
}
const AMENITIES = [];
const AMENITIES_LOOKAHEAD = 0.04;
const AMENITIES_PASSED_WINDOW = 0.04;
const AMENITIES_MAX_SHOW = 5;

// precise stop ratio / labels injected from Python
const STOP_RATIO      = 1.000000;
const FROM_LABEL      = "E10";
const TARGET_LABEL    = "F20";
const TARGET_HINT_SEC = 531.000;
// Video is on main walkway: dot starts/ends at junction, not at gate
const DOT_START_OFFSET = 0.0000;
const DOT_END_OFFSET   = 0.0000;

/**
 * Polyline progress in an arbitrary 2D plane (Euclidean segment lengths + linear interp on the active segment).
 */
function orientaMapSplitFromPathProgressPlanar_(path, rawRatio, dotStart, dotEnd) {
  var span = Math.max(0, 1 - dotStart - dotEnd);
  var u = dotStart + span * Math.max(0, Math.min(1, rawRatio));
  var n = path.length;
  if (n < 2) {
    return { coord: path[0], pastCoords: path.slice(), futureCoords: path.slice(), si: 0, tt: 0, b: path[0], n: n };
  }
  var segs = [];
  var total = 0;
  for (var i = 1; i < n; i++) {
    var dx = path[i][0] - path[i - 1][0];
    var dy = path[i][1] - path[i - 1][1];
    segs.push(Math.sqrt(dx * dx + dy * dy));
    total += segs[segs.length - 1];
  }
  if (total <= 0) {
    return { coord: path[0], pastCoords: [path[0]], futureCoords: path.slice(), si: 0, tt: 0, b: path[1] || path[0], n: n };
  }
  var dist = Math.max(0, Math.min(1, u)) * total;
  var acc = 0;
  var si = 0;
  for (; si < segs.length; si++) {
    if (acc + segs[si] >= dist - 1e-12) break;
    acc += segs[si];
  }
  if (si >= segs.length) si = segs.length - 1;
  var sl = segs[si];
  var tt = sl > 1e-15 ? (dist - acc) / sl : 0;
  tt = Math.max(0, Math.min(1, tt));
  var a = path[si],
    b = path[si + 1];
  var coord = [a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])];
  var pastCoords = path.slice(0, si + 1);
  if (tt > 1e-6) pastCoords.push(coord);
  var futureCoords = tt < 1 - 1e-6 ? [coord].concat(path.slice(si + 1)) : path.slice(si + 1);
  return { coord: coord, pastCoords: pastCoords, futureCoords: futureCoords, si: si, tt: tt, b: b, n: n };
}
/**
 * [lng,lat][] video progress -> split geometry for the map.
 * When OpenLayers is present, arc length + interpolation are done in EPSG:3857 so the dot lies on the same straight
 * screen segments as OL (Lon/Lat linear interp does not — the marker visibly “leaves” the polyline).
 */
function orientaMapSplitFromPathProgress_(path, rawRatio, dotStart, dotEnd) {
  if (!path || path.length < 1) return null;
  if (typeof ol !== "undefined" && ol.proj && path.length >= 2) {
    try {
      var proj3857 = ol.proj.get("EPSG:3857");
      var xy = [];
      for (var pi = 0; pi < path.length; pi++) {
        xy.push(ol.proj.fromLonLat(path[pi], proj3857));
      }
      var r = orientaMapSplitFromPathProgressPlanar_(xy, rawRatio, dotStart, dotEnd);
      if (!r || !r.coord) return null;
      function toLL(p) {
        return ol.proj.toLonLat(p, proj3857);
      }
      return {
        coord: toLL(r.coord),
        pastCoords: r.pastCoords.map(toLL),
        futureCoords: r.futureCoords.map(toLL),
        si: r.si,
        tt: r.tt,
        b: toLL(r.b),
        n: r.n,
      };
    } catch (eMerc) {}
  }
  return orientaMapSplitFromPathProgressPlanar_(path, rawRatio, dotStart, dotEnd);
}

var __orientaGateSegmentDistanceCache_ = null;
var ORIENTA_GATE_TIME_LEAD_SEC = 0;
function orientaPathCumMeters_(path) {
  var cum = [0];
  for (var i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + orientaHaversineM_(path[i - 1], path[i]));
  }
  return cum;
}
/** Gate → path anchor: use nearest polyline *vertex* arc-length (matches video keyframes on path indices). */
function orientaNearestPathVertexDistMeters_(path, cum, coord) {
  if (!path || !cum || path.length !== cum.length || !coord) return null;
  var bestIdx = -1;
  var bestD = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = orientaHaversineM_(path[i], coord);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || !Number.isFinite(cum[bestIdx])) return null;
  return cum[bestIdx];
}
/**
 * Map dot vs video: polyline Δd/segmentTime can still feel fast on some legs. Re-time anchor `t`
 * in JS only — **do not edit PEK_gate_timestamp.csv** for pacing; that file stays the editorial source.
 * Stretch each segment's Δt ~ (path_speed / median)^gamma, preserving first→last span.
 * Last N segments (default 2) get tailBoost; penultimate segment gets penultExtra (defaults below).
 * **Per-segment overrides** (replace global tail/penult for that leg only; built-in defaults apply if omitted):
 *   ?orientaGateSegTailBoost=E30_E29:1.55,E29_SECURITY_CHECKPOINT2:1.25
 *   ?orientaGateSegPenultBoost=E30_E29:1.2
 * Keys: FROM_TO with gates as in CSV after normalize, e.g. E30_E29, E29_SECURITY_CHECKPOINT2 (underscore).
 * Extra slow-walk for E30→E29 only (after tail×penult): ?orientaGateE3029Extra=1.3 (default 1.22, max 1.45)
 * Disable stretch: ?orientaGateTimeStretch=0 — global: ?orientaGateTimeTailBoost= &orientaGateTimePenultBoost=
 */
function orientaPekGateStretchSegKey_(fromG, toG) {
  var a = orientaNormalizeGate_(fromG);
  var b = orientaNormalizeGate_(toG);
  if (!a || !b) return "";
  return a + "_" + b;
}
/** Parse ?orientaGateSegTailBoost= or ?orientaGateSegPenultBoost= (FROM_TO:mult pairs, comma/semicolon). */
function orientaParseGateSegMultMap_(paramName) {
  var out = Object.create(null);
  try {
    var raw = String(new URLSearchParams(window.location.search).get(paramName) || "").trim();
    if (!raw) return out;
    var parts = raw.split(/[,;]/);
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      var eq = s.indexOf(":");
      if (eq < 1) continue;
      var key = s
        .slice(0, eq)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/^GATE_/, "");
      var v = parseFloat(s.slice(eq + 1).trim());
      if (!Number.isFinite(v) || v < 0.35 || v > 3.0) continue;
      out[key] = v;
    }
  } catch (e) {}
  return out;
}
function orientaGateSegBoostCacheSig_() {
  try {
    var sp = new URLSearchParams(window.location.search);
    return (
      String(sp.get("orientaGateSegTailBoost") || "") +
      "|" +
      String(sp.get("orientaGateSegPenultBoost") || "") +
      "|" +
      String(sp.get("orientaGateE3029Extra") || "")
    );
  } catch (e) {
    return "";
  }
}
/** Built-in tail/penult multipliers by segment key (URL maps override). Tunes E32→…→Security without CSV edits. */
var ORIENTA_PEK_GATE_SEG_TAIL_DEFAULTS = {
  E30_E29: 1.62,
  E29_SECURITY_CHECKPOINT2: 1.22,
};
var ORIENTA_PEK_GATE_SEG_PENULT_DEFAULTS = {
  E30_E29: 1.28,
};
/** Bump when ORIENTA_PEK_GATE_SEG_*_DEFAULTS change (cache key). */
var ORIENTA_PEK_GATE_SEG_STRETCH_DEFAULTS_REV = "v9";
function orientaPekMergeSegMultDefaults_(target, defaults) {
  if (!target || !defaults) return;
  for (var dk in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, dk)) continue;
    if (!Object.prototype.hasOwnProperty.call(target, dk)) target[dk] = defaults[dk];
  }
}
function orientaPekGateAnchorTimeStretchEnabled_() {
  if (window.__ROUTESITE_HUB__ !== "PEK") return false;
  try {
    if (/^(0|false|no|off)$/i.test(String(new URLSearchParams(window.location.search).get("orientaGateTimeStretch") || "").trim()))
      return false;
  } catch (e) {
    /* ignore */
  }
  return true;
}
function orientaApplyPekGateAnchorTimePathStretch_(anchors) {
  if (!anchors || anchors.length < 3) return;
  if (!orientaPekGateAnchorTimeStretchEnabled_()) return;
  var n = anchors.length;
  var tFirst = Number(anchors[0].t);
  var tLast = Number(anchors[n - 1].t);
  var span = tLast - tFirst;
  if (!Number.isFinite(span) || !(span > 0)) return;
  var dts = [];
  var dds = [];
  for (var i = 1; i < n; i++) {
    var dt = Number(anchors[i].t) - Number(anchors[i - 1].t);
    var dd = Number(anchors[i].d) - Number(anchors[i - 1].d);
    if (!Number.isFinite(dt) || dt <= 0) dt = 1e-6;
    if (!Number.isFinite(dd) || dd < 0) dd = 0;
    dts.push(dt);
    dds.push(dd);
  }
  var segSpeed = [];
  for (var j = 0; j < dts.length; j++) {
    segSpeed.push(dds[j] / dts[j]);
  }
  var sorted = segSpeed.slice().sort(function (a, b) {
    return a - b;
  });
  var mid = Math.floor(sorted.length / 2);
  var med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!Number.isFinite(med) || !(med > 0)) med = 1e-6;
  var gamma = 0.42;
  try {
    var g2 = Number(new URLSearchParams(window.location.search).get("orientaGateTimeStretchGamma"));
    if (Number.isFinite(g2) && g2 > 0.08 && g2 <= 1.0) gamma = g2;
  } catch (eG) {}
  var tailSegs = 2;
  var tailBoost = 1.32;
  var penultExtra = 1.16;
  try {
    var spT = new URLSearchParams(window.location.search);
    var ts = Number(spT.get("orientaGateTimeTailSegments"));
    if (Number.isFinite(ts) && ts >= 1 && ts <= 10) tailSegs = Math.round(ts);
    var tb = Number(spT.get("orientaGateTimeTailBoost"));
    if (Number.isFinite(tb) && tb >= 1 && tb <= 1.55) tailBoost = tb;
    var pe = Number(spT.get("orientaGateTimePenultBoost"));
    if (Number.isFinite(pe) && pe >= 1 && pe <= 1.4) penultExtra = pe;
  } catch (eT) {}
  var segTailMap = orientaParseGateSegMultMap_("orientaGateSegTailBoost");
  var segPenultMap = orientaParseGateSegMultMap_("orientaGateSegPenultBoost");
  orientaPekMergeSegMultDefaults_(segTailMap, ORIENTA_PEK_GATE_SEG_TAIL_DEFAULTS);
  orientaPekMergeSegMultDefaults_(segPenultMap, ORIENTA_PEK_GATE_SEG_PENULT_DEFAULTS);
  var tailIdx0 = Math.max(0, dts.length - tailSegs);
  var sumNew = 0;
  var mults = [];
  var penultK = dts.length >= 2 ? dts.length - 2 : -1;
  for (var k = 0; k < dts.length; k++) {
    var ratio = Math.max(1e-6, segSpeed[k] / med);
    var m = Math.pow(ratio, gamma);
    var ag = anchors[k] && anchors[k].g;
    var bg = anchors[k + 1] && anchors[k + 1].g;
    var sk = orientaPekGateStretchSegKey_(ag, bg);
    if (k >= tailIdx0) {
      var tc = sk && Object.prototype.hasOwnProperty.call(segTailMap, sk) ? segTailMap[sk] : null;
      m *= Number.isFinite(tc) ? tc : tailBoost;
    }
    if (k === penultK) {
      var pc = sk && Object.prototype.hasOwnProperty.call(segPenultMap, sk) ? segPenultMap[sk] : null;
      m *= Number.isFinite(pc) ? pc : penultExtra;
    }
    if (sk === "E30_E29") {
      var x3029 = 1.22;
      try {
        var nx = Number(new URLSearchParams(window.location.search).get("orientaGateE3029Extra"));
        if (Number.isFinite(nx) && nx >= 1 && nx <= 1.45) x3029 = nx;
      } catch (e3029) {}
      m *= x3029;
    }
    m = Math.max(0.55, Math.min(3.45, m));
    mults.push(m);
    sumNew += dts[k] * m;
  }
  if (!(sumNew > 0)) return;
  var scale = span / sumNew;
  var acc = tFirst;
  for (var p = 0; p < dts.length; p++) {
    acc += dts[p] * mults[p] * scale;
    anchors[p + 1].t = acc;
  }
  anchors[n - 1].t = tLast;
}
function orientaBuildGateSegmentDistanceCache_(path) {
  if (!path || path.length < 2 || !Array.isArray(ROUTE_GATE_SEGMENTS) || ROUTE_GATE_SEGMENTS.length < 2) return null;
  var stretchOn = orientaPekGateAnchorTimeStretchEnabled_();
  var key =
    orientaPathLonLatDigest_(path) +
    "|" +
    String(ROUTE_GATE_SEGMENTS.length) +
    (stretchOn
      ? "|gtps1v5_" +
        encodeURIComponent(orientaGateSegBoostCacheSig_()).slice(0, 240) +
        "|d=" +
        ORIENTA_PEK_GATE_SEG_STRETCH_DEFAULTS_REV
      : "|gtps0");
  if (__orientaGateSegmentDistanceCache_ && __orientaGateSegmentDistanceCache_.key === key) return __orientaGateSegmentDistanceCache_;
  if (!orientaGetPekGateCoordMap_() || !Object.keys(orientaGetPekGateCoordMap_()).length) return null;
  var cum = orientaPathCumMeters_(path);
  var total = cum[cum.length - 1];
  if (!(total > 0)) return null;
  var anchors = [];
  for (var j = 0; j < ROUTE_GATE_SEGMENTS.length; j++) {
    var seg = ROUTE_GATE_SEGMENTS[j];
    var t = Number(seg && seg.segmentTime);
    var gk = orientaNormalizeGate_(seg && seg.gate);
    var c = orientaLookupPekEGateLngLat_(gk, seg && seg.floor);
    if (!Number.isFinite(t) || !c) continue;
    var dGate = orientaNearestPathVertexDistMeters_(path, cum, c);
    if (!Number.isFinite(dGate)) continue;
    if (anchors.length) {
      var prev = anchors[anchors.length - 1];
      if (t < prev.t) continue;
      if (dGate < prev.d) dGate = prev.d;
    }
    anchors.push({ t: t, d: dGate, g: gk });
  }
  if (anchors.length < 2 || !(anchors[anchors.length - 1].t > anchors[0].t)) return null;
  orientaApplyPekGateAnchorTimePathStretch_(anchors);
  __orientaGateSegmentDistanceCache_ = { key: key, anchors: anchors, total: total };
  return __orientaGateSegmentDistanceCache_;
}
function orientaMapBaseFromGateSegments_(base, path, videoTimeSec) {
  var cache = orientaBuildGateSegmentDistanceCache_(path);
  if (!cache) return null;
  var anchors = cache.anchors;
  var first = anchors[0];
  var last = anchors[anchors.length - 1];
  var t;
  if (Number.isFinite(videoTimeSec)) {
    t = Number(videoTimeSec);
    // Anchor `t` comes from ROUTE_GATE_SEGMENTS.segmentTime (= CSV globalClipT on the clip axis).
    // orientaVideoLocalSecForGateSync_ / __orientaPekFloorSwitchLocalSec_ are **clip-local** (0 at clip start on the element).
    // Without this offset the dot is clamped to the first gate until local seconds exceed first.t — desync from video.
    try {
      if (typeof __pekClip !== "undefined" && __pekClip != null && orientaPekClipTimelineMode_() === "merged") {
        var clipT0 = Number(__pekClip.t0);
        if (Number.isFinite(clipT0)) t = clipT0 + t;
      }
    } catch (eTalign) {}
  } else {
    t = first.t + Math.max(0, Math.min(1, Number(base))) * (last.t - first.t);
  }
  t += ORIENTA_GATE_TIME_LEAD_SEC;
  t = Math.max(first.t, Math.min(last.t, t));
  var i = 0;
  for (; i < anchors.length - 1; i++) {
    if (t <= anchors[i + 1].t + 1e-9) break;
  }
  var a = anchors[Math.min(i, anchors.length - 2)];
  var b = anchors[Math.min(i + 1, anchors.length - 1)];
  var dt = Math.max(1e-9, b.t - a.t);
  var u = Math.max(0, Math.min(1, (t - a.t) / dt));
  var d = a.d + u * (b.d - a.d);
  return Math.max(0, Math.min(1, d / cache.total));
}
function orientaVideoLocalSecForGateSync_(curAbsSec) {
  var t = Number(curAbsSec);
  if (!Number.isFinite(t)) return null;
  try {
    if (typeof __pekClip !== "undefined" && __pekClip && vid) {
      var pb = orientaPekClipPlayBoundsForVid_(vid);
      var t0 = pb && Number.isFinite(pb.t0) ? pb.t0 : Number(__pekClip.t0);
      if (Number.isFinite(t0)) return Math.max(0, t - t0);
    }
  } catch (e) {}
  return Math.max(0, t);
}

/** Same-origin /api on the Vite admin server (e.g. :5174); override with ?sensorBackend=http://host:port */
var ROUTE_SITE_TENANT_ID = orientaRouteSiteCfg_().tenantId || "airchina";
var ROUTE_SITE_PASSENGER_ID = "";
try {
  var __osp = new URLSearchParams(location.search);
  var __defTenant = orientaRouteSiteCfg_().tenantId || "airchina";
  ROUTE_SITE_TENANT_ID = (__osp.get("tenant") || __defTenant).trim() || __defTenant;
  var __rawPax = (__osp.get("pax") || __osp.get("pid") || __osp.get("pix") || "").trim();
  var __paxAlias = orientaRouteSiteCfg_().paxAliases || { DA8X3: "TX1", DB5K7: "TX3", DC2N9: "TX2" };
  ROUTE_SITE_PASSENGER_ID = __paxAlias[__rawPax.toUpperCase()] || __rawPax;
} catch (e) {}
var SENSOR_BACKEND_URL = "";
try {
  var __sb = new URLSearchParams(location.search).get("sensorBackend");
  if (__sb && String(__sb).trim()) SENSOR_BACKEND_URL = String(__sb).trim().replace(/\/$/, "");
} catch (e) {}
/** Tourist position sync cadence: tune by URL (?touristPushMs=...&touristHeartbeatMs=...). */
var ORIENTA_TOURIST_PUSH_MIN_MS = 120;
var ORIENTA_TOURIST_HEARTBEAT_MS = 800;
try {
  var __spSync = new URLSearchParams(location.search);
  var __pushMs = Number(__spSync.get("touristPushMs"));
  var __beatMs = Number(__spSync.get("touristHeartbeatMs"));
  if (Number.isFinite(__pushMs)) ORIENTA_TOURIST_PUSH_MIN_MS = Math.max(80, Math.min(2000, Math.round(__pushMs)));
  if (Number.isFinite(__beatMs)) ORIENTA_TOURIST_HEARTBEAT_MS = Math.max(300, Math.min(10000, Math.round(__beatMs)));
} catch (eSyncCfg) {}
/** Opaque id for logs / future session store; back office keys off tenant_id + passenger_id */
var SENSOR_SESSION_ID = ROUTE_SITE_TENANT_ID + "_" + ROUTE_SITE_PASSENGER_ID;
/** 腾讯位置服务 JS API GL key：https://lbs.qq.com/console/mykey.html — 也可 ?tencentKey= 或 window.TENCENT_MAP_KEY */
const TENCENT_MAP_KEY = "";
let GATE_CHECKPOINTS = [{"gate": "E10", "segmentTime": 0.0}, {"gate": "E7", "segmentTime": 3.0}, {"gate": "E4", "segmentTime": 73.0}, {"gate": "E1", "segmentTime": 182.0}, {"gate": "F13", "segmentTime": 423.0}, {"gate": "F16", "segmentTime": 480.0}, {"gate": "F19", "segmentTime": 531.0}] || [];
let ROUTE_GATE_SEGMENTS = [{"gate": "E10", "segmentTime": 0.0}, {"gate": "E9", "segmentTime": 0.0}, {"gate": "E8", "segmentTime": 0.0}, {"gate": "E7", "segmentTime": 3.0}, {"gate": "E6", "segmentTime": 34.0}, {"gate": "E5", "segmentTime": 60.0}, {"gate": "E4", "segmentTime": 73.0}, {"gate": "E3", "segmentTime": 140.0}, {"gate": "E2", "segmentTime": 156.0}, {"gate": "E1", "segmentTime": 182.0}, {"gate": "F11", "segmentTime": 388.0}, {"gate": "F12", "segmentTime": 395.0}, {"gate": "F13", "segmentTime": 423.0}, {"gate": "F14", "segmentTime": 428.0}, {"gate": "F15", "segmentTime": 480.0}, {"gate": "F16", "segmentTime": 480.0}, {"gate": "F17", "segmentTime": 508.0}, {"gate": "F18", "segmentTime": 510.0}, {"gate": "F19", "segmentTime": 531.0}, {"gate": "F20", "segmentTime": 531.0}] || [];
let SEGMENT_DURATION = Number(531.000) || 60;
if (__pekRows && __pekRows.length) {
  if (__pekClip) {
    orientaRebuildRouteGateSegmentsFromClip_();
  } else {
    ROUTE_GATE_SEGMENTS = __pekRows.map(function(r) {
      var st = r.globalClipT != null && Number.isFinite(r.globalClipT) ? r.globalClipT : r.segmentTime;
      return { gate: r.gate, segmentTime: st, floor: r.floor };
    });
    GATE_CHECKPOINTS = __pekRows.slice(1).map(function(r) {
      var st = r.globalClipT != null && Number.isFinite(r.globalClipT) ? r.globalClipT : r.segmentTime;
      return { gate: r.gate, segmentTime: st, floor: r.floor };
    });
    var _lt = __pekRows[__pekRows.length - 1].globalClipT;
    if (!Number.isFinite(_lt)) _lt = __pekRows[__pekRows.length - 1].segmentTime;
    SEGMENT_DURATION = Math.max(120, _lt + 90);
  }
} else if (window.__ROUTESITE_HUB__ === 'PEK') {
  ROUTE_GATE_SEGMENTS = [];
  GATE_CHECKPOINTS = [];
  SEGMENT_DURATION = 600;
}


// elements (people canvas removed – OpenLayers map used instead)
const vid  = document.getElementById('vid');
if (vid) {
  var __orientaUseNativeVideoControls_ = window.matchMedia('(min-width: 901px)').matches;
  if (!__orientaUseNativeVideoControls_) vid.removeAttribute('controls');
  else if (typeof __pekClip !== 'undefined' && __pekClip) vid.removeAttribute('controls');
}
const info = document.getElementById('info');
const phoneRoot = document.querySelector('.phone');
const mediaPeople  = document.getElementById('mediaPeople');
const pager = document.getElementById('pager');
const mapDragHandle = document.getElementById('mapDragHandle');
const pages = document.getElementById('pages');
const amenitiesPanel = document.getElementById('amenitiesPanel');
const amenitiesVideoOverlay = document.getElementById('amenitiesVideoOverlay');
const amenitiesVideoList = document.getElementById('amenitiesVideoList');
// ---------- gate checkpoint: "Did you get to Gate X?" (every 3 gates) ----------
const gateCheckpointTriggered = new Set();
var __orientaMapPoiCheckpointTriggered_ = new Set();
// Demo mode: keep the video running when passing intermediate gate checkpoints.
// This avoids pausing at E17/E18/E19 during demo playback, so back-office trajectory keeps streaming.
const AUTO_GATE_CONTINUE = (() => {
  try {
    const sp = new URLSearchParams(location.search);
    return sp.get("autoGate") === "1";
  } catch (e) {
    return false;
  }
})();
let gateToSegmentTime = buildGateToSegmentTimeMap();
const gateCheckpointOverlay = document.getElementById('gateCheckpointOverlay');
const relocatePoiOverlay = document.getElementById('relocatePoiOverlay');
const relocatePoiList = document.getElementById('relocatePoiList');
const relocatePoiHint = document.getElementById('relocatePoiHint');
const relocatePoiSelected = document.getElementById('relocatePoiSelected');
const relocatePoiConfirm = document.getElementById('relocatePoiConfirm');
const ORIENTA_PEK_RELOC_CSV = ORIENTA_PEK_GATE_CSV;
var __orientaRelocatePoiSelectedRow_ = null;
var __orientaRelocatePoiListRows_ = [];
const gateWhichGateOverlay = document.getElementById('gateWhichGateOverlay');
const gateCheckpointNameEl = document.getElementById('gateCheckpointName');
const gateWhichGateInput = document.getElementById('gateWhichGateInput');
let currentCheckpointGate = null;
let currentCheckpointSegmentTime = null;

function orientaFormatPoiCheckpointLabel_(name, category) {
  var raw = String(name || '').trim();
  if (!raw) return '—';
  var norm = orientaNormalizeGate_(raw.replace(/^gate_/i, ''));
  if (/^E\d+$/i.test(norm)) return norm;
  if (/^F\d+$/i.test(norm)) return norm;
  if (/security|checkpoint|安检/i.test(raw) || String(category || '').toLowerCase() === 'security') {
    return raw.replace(/^gate_/i, '').replace(/_/g, ' ');
  }
  return raw.replace(/^gate_/i, '').replace(/_/g, ' ');
}
function showGateCheckpointModal(gateName, segmentTime, category) {
  currentCheckpointGate = gateName;
  currentCheckpointSegmentTime = segmentTime;
  var label = orientaFormatPoiCheckpointLabel_(gateName, category);
  var isSecurity = /security|checkpoint|安检/i.test(String(gateName || '') + String(category || ''));
  var qEl = document.getElementById('gateCheckpointQuestion');
  if (qEl) {
    qEl.innerHTML = isSecurity
      ? 'Have you reached <span id="gateCheckpointName">' + (label || '—') + '</span>?'
      : 'Did you get to Gate <span id="gateCheckpointName">' + (label || '—') + '</span>?';
  } else if (gateCheckpointNameEl) {
    gateCheckpointNameEl.textContent = label;
  }
  if (gateCheckpointOverlay) { gateCheckpointOverlay.classList.add('visible'); gateCheckpointOverlay.setAttribute('aria-hidden', 'false'); }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  var notifyBody = isSecurity
    ? 'Have you reached ' + label + '?'
    : 'Did you get to Gate ' + label + '?';
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Route check', { body: notifyBody });
    }
  } catch (e) {}
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().then(function(p) { if (p === 'granted') { try { new Notification('Route check', { body: notifyBody }); } catch (e) {} } });
  }
}
function hideGateCheckpointModal() {
  if (gateCheckpointOverlay) { gateCheckpointOverlay.classList.remove('visible'); gateCheckpointOverlay.setAttribute('aria-hidden', 'true'); }
  currentCheckpointGate = null;
}
function showWhichGateModal() {
  if (gateWhichGateOverlay) { gateWhichGateOverlay.classList.add('visible'); gateWhichGateOverlay.setAttribute('aria-hidden', 'false'); }
  if (gateWhichGateInput) { gateWhichGateInput.value = ''; gateWhichGateInput.focus(); }
}
function hideWhichGateModal() {
  if (gateWhichGateOverlay) { gateWhichGateOverlay.classList.remove('visible'); gateWhichGateOverlay.setAttribute('aria-hidden', 'true'); }
}

/** Clip-local seconds for gate checkpoint compare/seek (matches orientaVideoLocalSecForGateSync_). */
function orientaGateCheckpointClipT0_() {
  try {
    if (typeof __pekClip !== "undefined" && __pekClip) {
      var t0 = Number(__pekClip.t0);
      if (Number.isFinite(t0)) return t0;
    }
  } catch (e) {}
  return 0;
}
function orientaGateCheckpointVideoSec_(curAbs) {
  var cur = Number.isFinite(curAbs) ? curAbs : (vid && Number.isFinite(vid.currentTime) ? vid.currentTime : 0);
  var local = orientaVideoLocalSecForGateSync_(cur);
  return Number.isFinite(local) ? local : Math.max(0, cur);
}
function orientaPekClipTimelineMode_() {
  try {
    if (typeof __pekClip !== "undefined" && __pekClip && __pekClip.timeline === "segment") return "segment";
    if (typeof __pekClip !== "undefined" && __pekClip && __pekClip.timeline === "dynamic") return "dynamic";
  } catch (e) {}
  return "merged";
}
function orientaGateCheckpointSegLocalSec_(seg) {
  var st = Number(seg && seg.segmentTime);
  if (!Number.isFinite(st)) return NaN;
  if (typeof __pekClip !== "undefined" && __pekClip) {
    var t0 = Number(__pekClip.t0);
    if (orientaPekClipTimelineMode_() === "dynamic") return Math.max(0, st);
    if (orientaPekClipTimelineMode_() === "segment") {
      return Number.isFinite(t0) ? Math.max(0, st - t0) : Math.max(0, st);
    }
    return Math.max(0, st - orientaGateCheckpointClipT0_());
  }
  return st;
}
/** CSV 段内 segmentTime 或母带 globalClipT → HTMLVideoElement.currentTime */
function orientaGateCheckpointVideoTimeFromSeg_(segTime) {
  var st = Number(segTime);
  if (!Number.isFinite(st)) return 0;
  if (orientaPekClipTimelineMode_() === "segment" || orientaPekClipTimelineMode_() === "dynamic") return Math.max(0, st);
  try {
    var bn = String(window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ || "").trim();
    if (bn && !orientaPekIsFullTimelineBasename_(bn)) {
      return Math.max(0, st - orientaGateCheckpointClipT0_());
    }
  } catch (e) {}
  return st;
}

/** 裁切起点及之前的闸门检查点视为已触发，避免一进页就弹窗 */
function orientaPrimeCheckpointsAtClipStart_(tLocal) {
  var t = Number(tLocal);
  if (!Number.isFinite(t)) t = 0;
  var EPS = 0.08;
  try {
    for (var gi = 0; gi < GATE_CHECKPOINTS.length; gi++) {
      var segTime = orientaGateCheckpointSegLocalSec_(GATE_CHECKPOINTS[gi]);
      if (!Number.isFinite(segTime)) continue;
      if (segTime <= t + EPS) gateCheckpointTriggered.add(gi);
      else gateCheckpointTriggered.delete(gi);
    }
    var pois = orientaGetRoutePoisForMapCheckpoint_();
    for (var pi = 0; pi < pois.length; pi++) {
      var pst = pois[pi].segmentTime;
      if (pst == null || !Number.isFinite(Number(pst))) continue;
      var pstLocal = orientaGateCheckpointSegLocalSec_({ segmentTime: Number(pst) });
      var key = String(pi);
      if (Number.isFinite(pstLocal) && pstLocal <= t + EPS) __orientaMapPoiCheckpointTriggered_.add(key);
      else __orientaMapPoiCheckpointTriggered_.delete(key);
    }
  } catch (ePrime) {}
}
function orientaPekVideoReadyForGateCheckpoints_() {
  if (!vid || !__orientaClipStartApplied) return false;
  if (!(vid.readyState >= 1)) return false;
  var local = orientaGateCheckpointVideoSec_(vid.currentTime);
  if (!Number.isFinite(local)) return false;
  if (typeof __pekClip === 'undefined' || !__pekClip) return true;
  var b = orientaPekClipPlayBoundsForVid_(vid);
  if (!b || !(b.tEnd > b.t0)) return true;
  var span = b.tEnd - b.t0;
  if (span > 2 && local > span * 0.82) {
    var pdrWalkOn =
      window.__ORIENTA_PDR__ &&
      window.__ORIENTA_PDR__.active &&
      orientaReadBoolParam_('pdrVideoSync', true);
    if (!pdrWalkOn) {
      try {
        vid.currentTime = b.t0;
        orientaPrimeCheckpointsAtClipStart_(0);
      } catch (eSnap) {}
      return false;
    }
  }
  return true;
}
function checkGateCheckpoint(curVideoSec) {
  if (!GATE_CHECKPOINTS || !GATE_CHECKPOINTS.length || !vid) return;
  if (typeof __pekClip !== 'undefined' && __pekClip && !__orientaClipStartApplied) return;
  if (!orientaPekVideoReadyForGateCheckpoints_()) return;
  const t =
    curVideoSec != null && Number.isFinite(Number(curVideoSec))
      ? orientaGateCheckpointVideoSec_(Number(curVideoSec))
      : orientaGateCheckpointVideoSec_(vid.currentTime);
  if (!Number.isFinite(t) || t < 0.12) return;
  const EPS = 0.05;
  for (let i = 0; i < GATE_CHECKPOINTS.length; i++) {
    if (gateCheckpointTriggered.has(i)) continue;
    const seg = GATE_CHECKPOINTS[i];
    const segTime = orientaGateCheckpointSegLocalSec_(seg);
    if (!Number.isFinite(segTime)) continue;
    if (t >= segTime - EPS) {
      gateCheckpointTriggered.add(i);
      if (!AUTO_GATE_CONTINUE) {
        vid.pause();
        setPlayPauseLabel();
        showGateCheckpointModal(seg.gate, segTime, /security|checkpoint/i.test(String(seg.gate || '')) ? 'security' : 'gate');
        try {
          var poisVid = orientaGetRoutePoisForMapCheckpoint_();
          for (var pi = 0; pi < poisVid.length; pi++) {
            if (orientaNormalizeGate_(poisVid[pi].name) === orientaNormalizeGate_(seg.gate)) {
              __orientaMapPoiCheckpointTriggered_.add(String(pi));
              if (pi >= __orientaPdrNextPoiIdx_) __orientaPdrNextPoiIdx_ = pi;
              break;
            }
          }
        } catch (eSyncMap) {}
        break;
      }
    }
  }
}

function lookupGateSegmentTime(userInput) {
  const s = (userInput || '').toString().trim().toUpperCase();
  if (!s) return null;
  if (gateToSegmentTime[s] !== undefined) return gateToSegmentTime[s];
  const m = /^([A-Z])\s*(\d+)$/.exec(s);
  if (m) {
    const letter = m[1], num = m[2];
    const variants = [letter + num, letter + parseInt(num, 10), letter + num.replace(/^0+/, '') || '0'];
    for (let i = 0; i < variants.length; i++) {
      if (gateToSegmentTime[variants[i]] !== undefined) return gateToSegmentTime[variants[i]];
    }
  }
  return null;
}

if (document.getElementById('gateCheckpointYes')) {
  document.getElementById('gateCheckpointYes').addEventListener('click', function() {
    hideGateCheckpointModal();
    var pois = orientaGetRoutePoisForMapCheckpoint_();
    if (pois.length) {
      __orientaPdrNextPoiIdx_ = Math.min(pois.length, __orientaPdrNextPoiIdx_ + 1);
    }
    try { vid.play(); } catch (e) {}
    setPlayPauseLabel();
  });
}
if (document.getElementById('gateCheckpointNo')) {
  document.getElementById('gateCheckpointNo').addEventListener('click', function() {
    hideGateCheckpointModal();
    showWhichGateModal();
  });
}
(function () {
  var btnReloc = document.getElementById('btnPdrRelocate');
  if (btnReloc) {
    btnReloc.addEventListener('click', function (e) {
      e.stopPropagation();
      orientaPdrManualRelocate_();
    });
  }
  var btnRelocCancel = document.getElementById('relocatePoiCancel');
  if (btnRelocCancel) {
    btnRelocCancel.addEventListener('click', function (e) {
      e.stopPropagation();
      orientaHideRelocatePoiPicker_();
    });
  }
  if (relocatePoiConfirm) {
    relocatePoiConfirm.addEventListener('click', function (e) {
      e.stopPropagation();
      orientaRelocatePoiConfirm_();
    });
  }
  if (relocatePoiOverlay) {
    var relocModal = relocatePoiOverlay.querySelector('.relocate-poi-modal');
    if (relocModal) {
      relocModal.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      relocModal.addEventListener('touchend', function (e) {
        e.stopPropagation();
      });
    }
    relocatePoiOverlay.addEventListener('click', function (e) {
      if (e.target === relocatePoiOverlay) orientaHideRelocatePoiPicker_();
    });
  }
  orientaUpdatePdrRelocateBtn_();
})();
if (gateWhichGateInput && document.getElementById('gateWhichGateSubmit')) {
  document.getElementById('gateWhichGateSubmit').addEventListener('click', function() {
    const raw = gateWhichGateInput.value;
    const segTime = lookupGateSegmentTime(raw);
    if (segTime == null) { gateWhichGateInput.placeholder = 'e.g. F18 (try another gate)'; return; }
    const dur = Number.isFinite(vid.duration) ? vid.duration : 0;
    var seekT = orientaGateCheckpointVideoTimeFromSeg_(segTime);
    vid.currentTime = Math.max(0, Math.min(seekT, dur));
    var seekLocal = orientaGateCheckpointSegLocalSec_({ segmentTime: segTime });
    const checkpointT =
      currentCheckpointSegmentTime != null
        ? orientaGateCheckpointSegLocalSec_({ segmentTime: currentCheckpointSegmentTime })
        : seekLocal;
    if (seekLocal < checkpointT - 0.5) vid.playbackRate = 1.15;
    else if (seekLocal > checkpointT + 0.5) vid.playbackRate = 0.9;
    else vid.playbackRate = 1.0;
    hideWhichGateModal();
    try { vid.play(); } catch (e) {}
    setPlayPauseLabel();
  });
  gateWhichGateInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('gateWhichGateSubmit').click();
  });
}

// ---------- sync tourist position to backend (for backoffice) ----------
var __orientaLastPostedMapFloor = null;
/**
 * 默认：PEK 随 CSV/视频进度切换内嵌地图楼层（F3↔F2）。加 orientaAutoIndoorFloorFromVideo=0|off|false 可关闭（底图不跟片）。
 */
function orientaAutoIndoorFloorFromVideoEnabled_() {
  try {
    if (window.__ROUTESITE_HUB__ !== "PEK") return false;
    var sp = new URLSearchParams(window.location.search);
    var ex = String(sp.get("orientaAutoIndoorFloorFromVideo") || "").trim();
    if (/^(0|false|no|off)$/i.test(ex)) return false;
    if (/^(1|true|yes|on)$/i.test(ex)) return true;
    return true;
  } catch (eA) {
    return false;
  }
}
/**
 * 默认：PDR 不替换地图上的「视频同步」圆点（否则会跳到手机推算位置再回到规划线，看起来像随机闪一下）。
 * 需要圆点跟随 PDR：URL 加 pdrOnMap=1 或 pdrMap=1。
 */
function orientaPdrOverridesVideoRouteDot_() {
  try {
    var sp = new URLSearchParams(location.search);
    if (/^(0|false|no|off)$/i.test(String(sp.get("pdrOnMap") || sp.get("pdrMap") || "").trim())) return false;
    if (/^(1|true|yes|on)$/i.test(String(sp.get("pdrOnMap") || sp.get("pdrMap") || "").trim())) return true;
    // 默认：地图圆点跟视频/规划线；仅 ?pdrOnMap=1 时跟 PDR 推算位置
    return false;
  } catch (eP) {
    return false;
  }
}
/** 通知内嵌 airport-map 切换 L3/L2 底图（与 F3 抵达 / F2 出发对应；受 orientaAutoIndoorFloorFromVideo 控制） */
function orientaMaybePostIndoorFloor_(lev) {
  if (!orientaAutoIndoorFloorFromVideoEnabled_()) return;
  var key = String(lev || '').trim().toUpperCase();
  if (key === 'F3') key = 'L3';
  if (key === 'F2') key = 'L2';
  if (key !== 'L3' && key !== 'L2' && key !== 'L1') return;
  if (__orientaLastPostedMapFloor === key) return;
  __orientaLastPostedMapFloor = key;
  try {
    window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ = key;
  } catch (eFl) {}
  try {
    var emb = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
    if (!emb || !emb.iframe || !emb.iframe.contentWindow) return;
    var tgt = emb.targetOrigin === '*' ? '*' : emb.targetOrigin;
    emb.iframe.contentWindow.postMessage({ type: 'orienta-indoor-set-floor', floor: key }, tgt);
  } catch (eM) {}
}
/** Effective [t0,tEnd] for PEK clip vs loaded file (CSV span can exceed MP4 length). */
function orientaPekClipPlayBoundsForVid_(v) {
  if (typeof __pekClip === "undefined" || !__pekClip || !v) return null;
  var t0 = Number(__pekClip.t0);
  var t1 = Number(__pekClip.t1);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null;
  var dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  // Pre-cut PEK route clips use local timeline [0..dur]; do not reuse global t0/t1 window.
  try {
    var bn = String(window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ || "").trim();
    if (bn && !orientaPekIsFullTimelineBasename_(bn)) {
      var localEnd = dur > 0 ? dur : Math.max(1, t1 - t0);
      return { t0: 0, tEnd: localEnd };
    }
  } catch (eBn) {}
  var tEnd = dur ? Math.min(t1, t0 + dur) : t1;
  if (!(tEnd > t0)) return { t0: t0, tEnd: t0 };
  return { t0: t0, tEnd: tEnd };
}
/** 0..1 along route vs video: full file = cur/dur; PEK clip = (cur-t0)/(tEnd-t0), tEnd=min(t1,t0+dur). */
function orientaVideoProgress01FromCur_(curClamped) {
  var dur = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
  if (!dur) return 0;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    var b = orientaPekClipPlayBoundsForVid_(vid);
    if (!b || !(b.tEnd > b.t0)) return 0;
    var c = Math.max(b.t0, Math.min(b.tEnd, curClamped));
    return (c - b.t0) / (b.tEnd - b.t0);
  }
  return Math.max(0, Math.min(1, curClamped / dur));
}
/** Low-pass filtered 0..1 progress for indoor map dot (only used when __ORIENTA_PATH_LONLAT_FROM_MAP__ is active). */
var __orientaMapDisplayBaseSmoothed_ = null;
var __orientaMapDisplayBaseLastRaw_ = null;
var __orientaSmoothedMapPathWasActive_ = false;
var ORIENTA_MAP_BASE_SMOOTH_ALPHA = 0.50;
var ORIENTA_MAP_BASE_SMOOTH_ALPHA_NEAR_CHECKPOINT = 0.80;
var ORIENTA_MAP_BASE_MAX_LAG = 0.018;
var ORIENTA_MAP_CHECKPOINT_BOOST_WINDOW_SEC = 0.8;
function orientaNearCheckpointBoostActive_() {
  try {
    if (!vid || !Array.isArray(ROUTE_GATE_SEGMENTS) || !ROUTE_GATE_SEGMENTS.length) return false;
    var t = Number.isFinite(vid.currentTime) ? vid.currentTime : null;
    if (!Number.isFinite(t)) return false;
    for (var i = 0; i < ROUTE_GATE_SEGMENTS.length; i++) {
      var seg = ROUTE_GATE_SEGMENTS[i];
      var st = Number(seg && seg.segmentTime);
      if (!Number.isFinite(st)) continue;
      if (Math.abs(t - st) <= ORIENTA_MAP_CHECKPOINT_BOOST_WINDOW_SEC) return true;
    }
  } catch (e) {}
  return false;
}
function orientaSmoothedMapDisplayBase_(rawBase, scrubbing) {
  var r = Math.max(0, Math.min(1, Number(rawBase)));
  if (scrubbing) {
    __orientaMapDisplayBaseSmoothed_ = r;
    __orientaMapDisplayBaseLastRaw_ = r;
    return r;
  }
  var seekJump = 0.05;
  if (
    __orientaMapDisplayBaseLastRaw_ != null &&
    Number.isFinite(__orientaMapDisplayBaseLastRaw_) &&
    Math.abs(r - __orientaMapDisplayBaseLastRaw_) > seekJump
  ) {
    __orientaMapDisplayBaseSmoothed_ = r;
    __orientaMapDisplayBaseLastRaw_ = r;
    return r;
  }
  __orientaMapDisplayBaseLastRaw_ = r;
  if (__orientaMapDisplayBaseSmoothed_ == null || !Number.isFinite(__orientaMapDisplayBaseSmoothed_)) {
    __orientaMapDisplayBaseSmoothed_ = r;
    return r;
  }
  var alpha = ORIENTA_MAP_BASE_SMOOTH_ALPHA;
  if (orientaNearCheckpointBoostActive_()) alpha = ORIENTA_MAP_BASE_SMOOTH_ALPHA_NEAR_CHECKPOINT;
  __orientaMapDisplayBaseSmoothed_ += alpha * (r - __orientaMapDisplayBaseSmoothed_);
  // Keep motion smooth, but don't let map dot lag too far behind video progress.
  if (r > __orientaMapDisplayBaseSmoothed_ + ORIENTA_MAP_BASE_MAX_LAG) {
    __orientaMapDisplayBaseSmoothed_ = r - ORIENTA_MAP_BASE_MAX_LAG;
  }
  __orientaMapDisplayBaseSmoothed_ = Math.max(0, Math.min(1, __orientaMapDisplayBaseSmoothed_));
  return __orientaMapDisplayBaseSmoothed_;
}
/** ?orientaMapSync=video — ignore CSV gate arc for map/dot; use wall-clock video progress only. */
function orientaMapSyncVideoOnly_() {
  try {
    return /^(1|true|yes|video)$/i.test(String(new URLSearchParams(window.location.search).get("orientaMapSync") || "").trim());
  } catch (e) {
    return false;
  }
}
/**
 * CSV gate timestamps + per-floor remap (af/sw) can push path arc 0..1 ahead of MP4 wall-clock `base`.
 * Cap how far ahead so the tourist dot / arrow stay tied to playback (tunable via ?orientaMapMaxLead=0.06).
 */
function orientaReadMapMaxLead01_() {
  var def = 0.04;
  try {
    var sp = new URLSearchParams(window.location.search);
    var ml = Number(sp.get("orientaMapMaxLead"));
    if (Number.isFinite(ml) && ml >= 0 && ml <= 0.45) return ml;
  } catch (e2) {}
  return def;
}
function orientaCapPathSyncToVideoProgress_(arc01, videoBase) {
  if (orientaMapSyncVideoOnly_()) return Math.max(0, Math.min(1, Number(videoBase)));
  if (!Number.isFinite(arc01) || !Number.isFinite(videoBase)) return arc01;
  var a = Math.max(0, Math.min(1, Number(arc01)));
  var b = Math.max(0, Math.min(1, Number(videoBase)));
  var ml = orientaReadMapMaxLead01_();
  if (a > b + ml) return b + ml;
  return a;
}
/**
 * Single resolution path for dot + past/future polylines (must match getCurrentTouristPosition).
 * drawPeoplePage previously used a separate mapSeg/uForMap chain and drifted — dot left the drawn line.
 * @param {number} base — 0..1 video timeline from orientaVideoProgress01FromCur_ (never gate-arc ratio).
 * @param {{ postFloor?: boolean, videoTimeSec?: number }} [opt]
 * @returns {{ ms: object|null, pathUsed: array|null }}
 */
function orientaResolveMapSplitMsFromVideo_(base, opt) {
  var postFloor = !!(opt && opt.postFloor);
  var pl = orientaGetPathLonLat_();
  if (!pl || pl.length < 2) return { ms: null, pathUsed: null };
  var videoTimeSec = opt && Number.isFinite(opt.videoTimeSec) ? Number(opt.videoTimeSec) : null;
  var gateTimeBase = orientaMapSyncVideoOnly_() ? null : orientaMapBaseFromGateSegments_(base, pl, videoTimeSec);
  /** Arc-length 0..1 along full path when gate CSV drives sync; else same as video base for floor-slice u. */
  var geomBase = gateTimeBase != null ? orientaCapPathSyncToVideoProgress_(gateTimeBase, base) : base;
  var ms = null;
  var pathUsed = pl;
  var floorsNav = window.__ORIENTA_PATH_POINT_FLOORS_FROM_MAP__;
  var useIndoorGeo = !!(window.__ORIENTA_PATH_LONLAT_FROM_MAP__ && pl && pl.length >= 2);
  if (useIndoorGeo) {
    var swNav =
      window.__ROUTESITE_HUB__ === "PEK" &&
      typeof __pekFloorSwitchTimeFrac !== "undefined" &&
      __pekFloorSwitchTimeFrac != null
        ? __pekFloorSwitchTimeFrac
        : null;
    var gNav =
      floorsNav && floorsNav.length === pl.length && swNav != null
        ? orientaMapSegAndUForIndoorFloors_(pl, floorsNav, base, swNav)
        : null;
    if (!orientaAutoIndoorFloorFromVideoEnabled_() && floorsNav && floorsNav.length === pl.length) {
      var dispP = String(window.__ORIENTA_INDOOR_DISPLAY_FLOOR__ || "L3").trim();
      if (!dispP) dispP = "L3";
      var segP = orientaSlicePathLonLatByFloorTag_(pl, floorsNav, dispP);
      var uP = orientaGlobalBaseToUOnFirstFloorRun_(pl, floorsNav, geomBase, dispP);
      if (segP && segP.length >= 2) {
        ms = orientaMapSplitFromPathProgress_(segP, uP, DOT_START_OFFSET, DOT_END_OFFSET);
        pathUsed = segP;
      }
    }
    // gNav: per-floor subpath + video u (or gate-arc u on that subpath). Never map L2 video progress onto full-path arc (≈E32).
    if (!ms && gNav) {
      var uNav = gNav.u;
      if (gateTimeBase != null) {
        var modeG = typeof __orientaPekClipFloorMode_ !== "undefined" ? __orientaPekClipFloorMode_ : null;
        if (modeG !== "L3_ONLY" && modeG !== "L2_ONLY") {
          var swArcG = null;
          try {
            if (Number.isFinite(__orientaPekFloorSwitchLocalSec_) && __orientaPekFloorSwitchLocalSec_ > 0) {
              swArcG = orientaMapBaseFromGateSegments_(base, pl, __orientaPekFloorSwitchLocalSec_);
            }
          } catch (eArcG) {}
          if (swArcG != null && Number.isFinite(swArcG) && swArcG > 1e-5 && swArcG < 1 - 1e-5) {
            uNav = orientaPekRemapGateArcForFloor_(gateTimeBase, swArcG, gNav.wantL3);
          }
        }
      }
      if (postFloor) orientaMaybePostIndoorFloor_(gNav.wantL3 ? "L3" : "L2");
      ms = orientaMapSplitFromPathProgress_(gNav.seg, uNav, DOT_START_OFFSET, DOT_END_OFFSET);
      pathUsed = gNav.seg;
    }
    if (!ms) {
      var rawRatioMap = gateTimeBase != null ? gateTimeBase : base;
      if (swNav != null) {
        var wantL3c = orientaPekVideoWantL3_(base, swNav);
        if (gateTimeBase == null && floorsNav && floorsNav.length === pl.length) {
          var _sliceMs = orientaMapMsFromFloorVideoSlice_(pl, floorsNav, base, swNav);
          if (_sliceMs && _sliceMs.ms) {
            ms = _sliceMs.ms;
            pathUsed = _sliceMs.pathUsed;
            if (postFloor) orientaMaybePostIndoorFloor_(wantL3c ? "L3" : "L2");
          }
        }
        if (!ms) {
          var mode = typeof __orientaPekClipFloorMode_ !== "undefined" ? __orientaPekClipFloorMode_ : null;
          if (gateTimeBase != null && mode !== "L3_ONLY" && mode !== "L2_ONLY") {
            var swArc = null;
            try {
              if (Number.isFinite(__orientaPekFloorSwitchLocalSec_) && __orientaPekFloorSwitchLocalSec_ > 0) {
                swArc = orientaMapBaseFromGateSegments_(base, pl, __orientaPekFloorSwitchLocalSec_);
              }
            } catch (eArc) {}
            if (swArc != null && Number.isFinite(swArc) && swArc > 1e-5 && swArc < 1 - 1e-5) {
              rawRatioMap = orientaPekRemapGateArcForFloor_(gateTimeBase, swArc, wantL3c);
            }
          } else if (gateTimeBase == null) {
            rawRatioMap = orientaPekRemapRatioForFloor_(rawRatioMap, swNav, wantL3c);
          }
          if (postFloor) orientaMaybePostIndoorFloor_(wantL3c ? "L3" : "L2");
        }
      }
      if (!ms) {
        rawRatioMap = orientaCapPathSyncToVideoProgress_(rawRatioMap, base);
        ms = orientaMapSplitFromPathProgress_(pl, rawRatioMap, DOT_START_OFFSET, DOT_END_OFFSET);
        pathUsed = pl;
      }
    }
  } else {
    var rawRatioMap2 = gateTimeBase != null ? gateTimeBase : base;
    if (
      window.__ROUTESITE_HUB__ === "PEK" &&
      typeof __pekFloorSwitchTimeFrac !== "undefined" &&
      __pekFloorSwitchTimeFrac != null
    ) {
      var wantL3b = orientaPekVideoWantL3_(base, __pekFloorSwitchTimeFrac);
      var mode2 = typeof __orientaPekClipFloorMode_ !== "undefined" ? __orientaPekClipFloorMode_ : null;
      if (gateTimeBase != null && mode2 !== "L3_ONLY" && mode2 !== "L2_ONLY") {
        var swArc2 = null;
        try {
          if (Number.isFinite(__orientaPekFloorSwitchLocalSec_) && __orientaPekFloorSwitchLocalSec_ > 0) {
            swArc2 = orientaMapBaseFromGateSegments_(base, pl, __orientaPekFloorSwitchLocalSec_);
          }
        } catch (eArc2) {}
        if (swArc2 != null && Number.isFinite(swArc2) && swArc2 > 1e-5 && swArc2 < 1 - 1e-5) {
          rawRatioMap2 = orientaPekRemapGateArcForFloor_(gateTimeBase, swArc2, wantL3b);
        }
      } else if (gateTimeBase == null) {
        rawRatioMap2 = orientaPekRemapRatioForFloor_(rawRatioMap2, __pekFloorSwitchTimeFrac, wantL3b);
      }
      if (postFloor) orientaMaybePostIndoorFloor_(wantL3b ? "L3" : "L2");
    }
    if (rawRatioMap2 != null) rawRatioMap2 = orientaCapPathSyncToVideoProgress_(rawRatioMap2, base);
    ms = orientaMapSplitFromPathProgress_(pl, rawRatioMap2, DOT_START_OFFSET, DOT_END_OFFSET);
    pathUsed = pl;
  }
  if (!ms || !ms.coord || !orientaCoordFiniteLngLat_(ms.coord)) return { ms: null, pathUsed: null };
  return { ms: ms, pathUsed: pathUsed };
}
function getCurrentTouristPosition() {
  var pl = orientaGetPathLonLat_();
  if (!pl || pl.length < 2 || !vid) return null;
  const dur = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
  if (!dur) return null;
  var cur;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    var pb = orientaPekClipPlayBoundsForVid_(vid);
    if (pb && pb.tEnd > pb.t0) cur = Math.max(pb.t0, Math.min(pb.tEnd, vid.currentTime));
    else cur = Math.max(0, Math.min(dur, vid.currentTime));
  } else {
    cur = Math.max(0, Math.min(dur, vid.currentTime));
  }
  const base = orientaVideoProgress01FromCur_(cur);
  const span = Math.max(0, 1 - DOT_START_OFFSET - DOT_END_OFFSET);
  var pathRatio = DOT_START_OFFSET + span * base;
  var gateSyncSec = orientaVideoLocalSecForGateSync_(cur);
  var _r = orientaResolveMapSplitMsFromVideo_(base, { postFloor: true, videoTimeSec: gateSyncSec });
  var ms = _r && _r.ms;
  try {
    var _cDisp = window.__ORIENTA_DISPLAY_MAP_SPLIT_RESOLVE__;
    if (
      _cDisp &&
      _cDisp.ms &&
      orientaCoordFiniteLngLat_(_cDisp.ms.coord) &&
      window.__ORIENTA_PATH_LONLAT_FROM_MAP__ &&
      window.__ORIENTA_PATH_LONLAT_FROM_MAP__.length >= 2
    ) {
      ms = _cDisp.ms;
    }
  } catch (eSync) {}
  if (!ms || !ms.coord || !orientaCoordFiniteLngLat_(ms.coord)) return null;
  return { path_fraction: pathRatio, lat: ms.coord[1], lng: ms.coord[0] };
}
var orientaTouristHttpFails_ = 0;
function orientaTouristRecordHttpFail_(httpStatus) {
  orientaTouristHttpFails_++;
  if (orientaTouristHttpFails_ < 4) return;
  window.__ORIENTA_SKIP_TOURIST_HTTP = true;
  if (typeof orientaRouteSiteDebugLog_ === "function") {
    orientaRouteSiteDebugLog_(
      "[tourist] stopped POST /api/tourist-position after repeated failures (last HTTP " +
        httpStatus +
        "). Safari \"Load failed\" = no response from this origin for /api (proxy Node, or ?sensorBackend=). Map/parent sync still uses postMessage.",
      true
    );
  }
}
function pushTouristPositionToBackend() {
  if (!ROUTE_SITE_PASSENGER_ID) return;
  const pos = getCurrentTouristPosition();
  if (!pos) return;
  var pathForMsg = null;
  var pathPayload = null;
  var plPush = orientaPathLonLatForCurrentIndoorFloor_();
  if (!plPush || plPush.length < 2) plPush = orientaGetPathLonLat_();
  if (plPush && plPush.length >= 2) {
    pathForMsg = plPush.map(function (c) { return { lat: c[1], lng: c[0] }; });
    pathPayload = pathForMsg;
    var maxPts = 150;
    if (pathPayload.length > maxPts) {
      var plAll = pathPayload;
      pathPayload = [];
      var stp = (plAll.length - 1) / (maxPts - 1);
      for (var pi = 0; pi < maxPts; pi++) {
        pathPayload.push(plAll[Math.min(plAll.length - 1, Math.round(pi * stp))]);
      }
    }
  }
  var skipHttp = !!window.__ORIENTA_SKIP_TOURIST_HTTP;
  try {
    if (!skipHttp) {
      var __spnt = new URLSearchParams(location.search);
      if (/^(1|true|yes)$/i.test(String(__spnt.get("noTouristHttp") || "").trim())) skipHttp = true;
    }
  } catch (eNt) {}
  var base = SENSOR_BACKEND_URL || "";
  if (!skipHttp) {
    var touristUrl =
      base ? String(base).replace(/\/$/, "") + "/api/tourist-position" : new URL(orientaApiUrl_("/api/tourist-position"), window.location.href).toString();
    try {
      fetch(touristUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: SENSOR_SESSION_ID,
          tenant_id: ROUTE_SITE_TENANT_ID,
          passenger_id: ROUTE_SITE_PASSENGER_ID,
          path_fraction: pos.path_fraction,
          lat: pos.lat,
          lng: pos.lng,
          path: pathPayload
        })
      })
        .then(function (res) {
          if (res && res.ok) {
            orientaTouristHttpFails_ = 0;
            return;
          }
          orientaTouristRecordHttpFail_(res ? res.status : 0);
        })
        .catch(function () {
          orientaTouristRecordHttpFail_(0);
        });
    } catch (e) {
      orientaTouristRecordHttpFail_(0);
    }
  }
  // Same path as spawn: parent /pax.html relays pax_trajectory on WS (reliable in nested iframes; HTTP can fail silently).
  try {
    if (window.parent && window.parent !== window) {
      var pathForWs = pathForMsg && pathForMsg.length ? pathForMsg : [{ lat: pos.lat, lng: pos.lng }];
      window.parent.postMessage(
        {
          type: "orienta-pax-trajectory",
          position: { lat: pos.lat, lng: pos.lng },
          path: pathForWs
        },
        window.location.origin
      );
    }
  } catch (e2) {}
  orientaForwardTouristPosToIndoorMap_(pos, pathPayload);
}
/** Same tangent as OL nav marker on route_site: atan2(-Δlat, Δlng) toward lookahead vertex along split. */
function orientaHeadingRadAlongSplitMs_(ms, pathUsedForMap) {
  if (!ms || !orientaCoordFiniteLngLat_(ms.coord) || !orientaCoordFiniteLngLat_(ms.b)) return null;
  var coord = ms.coord;
  var pathForHeading =
    pathUsedForMap != null && ms.n != null && pathUsedForMap.length === ms.n ? pathUsedForMap : null;
  var cNext =
    ms.tt < 1 - 1e-6
      ? ms.b
      : pathForHeading
        ? pathForHeading[Math.min(ms.si + 2, ms.n - 1)] || ms.b
        : ms.b;
  if (!orientaCoordFiniteLngLat_(cNext)) return null;
  var dx = cNext[0] - coord[0];
  var dy = cNext[1] - coord[1];
  if (Math.abs(dx) + Math.abs(dy) < 1e-12) {
    var fc = ms.futureCoords;
    if (Array.isArray(fc) && fc.length >= 2) {
      for (var fi = 1; fi < fc.length; fi++) {
        var p = fc[fi];
        if (!orientaCoordFiniteLngLat_(p)) continue;
        if (Math.abs(p[0] - coord[0]) + Math.abs(p[1] - coord[1]) > 1e-10) {
          cNext = p;
          dx = cNext[0] - coord[0];
          dy = cNext[1] - coord[1];
          break;
        }
      }
    }
  }
  if (Math.abs(dx) + Math.abs(dy) < 1e-12) {
    var pc = ms.pastCoords;
    if (Array.isArray(pc) && pc.length >= 2) {
      var prev = pc[pc.length - 2];
      if (orientaCoordFiniteLngLat_(prev)) {
        dx = coord[0] - prev[0];
        dy = coord[1] - prev[1];
      }
    }
  }
  if (Math.abs(dx) + Math.abs(dy) < 1e-12) return null;
  return Math.atan2(-dy, dx);
}
/** Heading for indoor Leaflet arrow while video drives the dot (PDR off); mirrors getCurrentTouristPosition map split. */
function orientaResolveHeadingRadForVideoIndoorMap_() {
  try {
    var vidEl = vid;
    if (!vidEl || !isFinite(vidEl.duration) || vidEl.duration <= 0) return null;
    var cur;
    if (typeof __pekClip !== "undefined" && __pekClip) {
      var pb = orientaPekClipPlayBoundsForVid_(vidEl);
      if (pb && pb.tEnd > pb.t0) cur = Math.max(pb.t0, Math.min(pb.tEnd, vidEl.currentTime));
      else cur = Math.max(0, Math.min(vidEl.duration, vidEl.currentTime));
    } else {
      cur = Math.max(0, Math.min(vidEl.duration, vidEl.currentTime));
    }
    var base = orientaVideoProgress01FromCur_(cur);
    var gateSyncSec = orientaVideoLocalSecForGateSync_(cur);
    var _r = orientaResolveMapSplitMsFromVideo_(base, { postFloor: true, videoTimeSec: gateSyncSec });
    var ms = _r && _r.ms;
    var pathUsed = _r && _r.pathUsed;
    try {
      var _cDisp = window.__ORIENTA_DISPLAY_MAP_SPLIT_RESOLVE__;
      if (
        _cDisp &&
        _cDisp.ms &&
        orientaCoordFiniteLngLat_(_cDisp.ms.coord) &&
        window.__ORIENTA_PATH_LONLAT_FROM_MAP__ &&
        window.__ORIENTA_PATH_LONLAT_FROM_MAP__.length >= 2
      ) {
        ms = _cDisp.ms;
        pathUsed = _cDisp.pathUsed;
      }
    } catch (eSync) {}
    return orientaHeadingRadAlongSplitMs_(ms, pathUsed);
  } catch (e) {
    return null;
  }
}
/** Forward video-tracked position into indoor map iframe so Leaflet can show live dot (see airport-map orienta-pax-map-position). */
function orientaForwardTouristPosToIndoorMap_(pos, pathPayload) {
  try {
    var emb = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
    if (!emb || !emb.iframe || !emb.iframe.contentWindow || !pos) return;
    var tgt = emb.targetOrigin === "*" ? "*" : emb.targetOrigin;
    var pdr = null;
    try {
      pdr =
        window.__ORIENTA_PDR__ &&
        window.__ORIENTA_PDR__.active &&
        typeof window.__ORIENTA_PDR__.getState === "function"
          ? window.__ORIENTA_PDR__.getState()
          : null;
    } catch (ePdrState) {
      pdr = null;
    }
    if (pdr && pdr.markerLngLat && pdr.markerLngLat.length >= 2) {
      var pdrTrail = Array.isArray(pdr.trail)
        ? pdr.trail
            .filter(function (c) {
              return c && isFinite(c[0]) && isFinite(c[1]);
            })
            .map(function (c) {
              return { lat: c[1], lng: c[0] };
            })
        : [];
      emb.iframe.contentWindow.postMessage(
        {
          type: "orienta-pax-map-position",
          source: "pdr",
          position: { lat: pdr.markerLngLat[1], lng: pdr.markerLngLat[0] },
          path: pdrTrail.length ? pdrTrail : [{ lat: pdr.markerLngLat[1], lng: pdr.markerLngLat[0] }],
          headingRad: pdr.headingRad,
        },
        tgt
      );
      return;
    }
    var vidMsg = {
      type: "orienta-pax-map-position",
      source: "video",
      position: { lat: pos.lat, lng: pos.lng },
      path: pathPayload || null,
    };
    var vidHeading = orientaResolveHeadingRadForVideoIndoorMap_();
    if (vidHeading != null && isFinite(vidHeading)) vidMsg.headingRad = vidHeading;
    emb.iframe.contentWindow.postMessage(vidMsg, tgt);
  } catch (eM) {}
}
// Push on timeline changes (not only a 2s timer): duration was 0 before loadedmetadata, and checkpoints pause the video.
var orientaLastTouristPushMs_ = 0;
function pushTouristPositionToBackendThrottled_(minMs) {
  var gap = minMs != null ? minMs : ORIENTA_TOURIST_PUSH_MIN_MS;
  var now = Date.now();
  if (now - orientaLastTouristPushMs_ < gap) return;
  orientaLastTouristPushMs_ = now;
  pushTouristPositionToBackend();
}
if (ROUTE_SITE_PASSENGER_ID && orientaGetPathLonLat_().length >= 2) {
  setInterval(pushTouristPositionToBackend, ORIENTA_TOURIST_HEARTBEAT_MS);
  pushTouristPositionToBackend();
  if (vid) {
    vid.addEventListener("loadedmetadata", function () {
      orientaLastTouristPushMs_ = 0;
      pushTouristPositionToBackend();
    });
    vid.addEventListener("seeked", function () {
      orientaLastTouristPushMs_ = 0;
      pushTouristPositionToBackend();
    });
    vid.addEventListener("timeupdate", function () {
      pushTouristPositionToBackendThrottled_(ORIENTA_TOURIST_PUSH_MIN_MS);
    });
  }
}

// Parent (/pax.html) asks for an immediate sync when 视频页 becomes visible; relay push / trajectory for optional indoor iframe.
window.addEventListener("message", function (e) {
  var d = e.data;
  var emb = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
  if (emb && emb.iframe && d && d.type === "orienta-nav-path-lonlat" && e.source === emb.iframe.contentWindow) {
    orientaApplyNavPathLonLatFromMap_(d.path, d.pointFloors, d.pathSteps);
    orientaLastTouristPushMs_ = 0;
    pushTouristPositionToBackendThrottled_(0);
    try {
      if (window.parent && window.parent !== window) {
        var stepsFwd =
          d.pathSteps && Array.isArray(d.pathSteps) && d.pathSteps.length
            ? d.pathSteps
            : window.__ORIENTA_NAV_PATH_STEPS__ || [];
        window.parent.postMessage({ type: "orienta-nav-path-debug", pathSteps: stepsFwd }, location.origin);
      }
    } catch (exDbg) {}
    return;
  }
  if (emb && emb.iframe && d && d.type === "orienta-pax-trajectory" && e.source === emb.iframe.contentWindow) {
    try {
      window.parent.postMessage(d, window.location.origin);
    } catch (ex) {}
    return;
  }
  if (e.origin !== window.location.origin) return;
  if (!d || d.type !== "orienta-push-tourist") return;
  orientaLastTouristPushMs_ = 0;
  pushTouristPositionToBackend();
  if (emb && emb.iframe && emb.iframe.contentWindow) {
    try {
      var tgt = emb.targetOrigin === "*" ? "*" : emb.targetOrigin;
      emb.iframe.contentWindow.postMessage({ type: "orienta-push-tourist" }, tgt);
    } catch (ex2) {}
  }
});

// Deactivate tourist when user closes/leaves the page so backoffice stops showing them.
// Use text/plain body to avoid CORS preflight (which is often cancelled on tab close).
function deactivateTouristOnBackend() {
  if (!ROUTE_SITE_PASSENGER_ID) return;
  var base = SENSOR_BACKEND_URL || "";
  var url = base ? base + "/api/tourist-deactivate" : orientaApiUrl_("/api/tourist-deactivate");
  var plainBody = ROUTE_SITE_TENANT_ID + "|" + ROUTE_SITE_PASSENGER_ID;
  var body = new Blob([plainBody], { type: "text/plain" });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
    fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: plainBody, keepalive: true }).catch(function () {});
  } catch (e) {}
}
window.addEventListener('pagehide', deactivateTouristOnBackend);
window.addEventListener('beforeunload', deactivateTouristOnBackend);
// Do NOT deactivate on visibilitychange (tab switch): that would remove the user when they open the backoffice tab

/** Optional `airport-map.html` iframe inside #mapPeople (see GET /api/orienta/route-site-map-embed). */
function orientaBuildIndoorEmbedSrc_(baseUrl, apiBase, tileBase, tileUrl) {
  var sp = new URLSearchParams(window.location.search);
  var u;
  try {
    u = new URL(baseUrl, window.location.href);
  } catch (e) {
    return "";
  }
  var airport = (sp.get("airport") || sp.get("hub") || window.__ROUTESITE_HUB__ || "PEK").toString().toUpperCase();
  u.searchParams.set("airport", airport);
  if (sp.get("tenant")) u.searchParams.set("tenant", String(sp.get("tenant")));
  if (sp.get("pax")) u.searchParams.set("pax", String(sp.get("pax")));
  var topOrigin = "";
  try {
    if (window.top && window.top.location) topOrigin = String(window.top.location.origin);
  } catch (e1) {}
  if (!topOrigin) {
    try {
      if (window.parent && window.parent !== window && window.parent.location) {
        topOrigin = String(window.parent.location.origin);
      }
    } catch (e2) {}
  }
  u.searchParams.set("mapRole", "passenger");
  if (topOrigin) u.searchParams.set("parentOrigin", topOrigin);
  var ab = apiBase && String(apiBase).trim() ? String(apiBase).trim() : "";
  if (ab) u.searchParams.set("apiBase", ab);
  var tb = tileBase && String(tileBase).trim() ? String(tileBase).trim() : "";
  if (tb) u.searchParams.set("tileBase", tb);
  var tu = tileUrl && String(tileUrl).trim() ? String(tileUrl).trim() : "";
  if (tu) u.searchParams.set("tileUrl", tu);
  var gf = sp.get("gateFrom");
  var gt = sp.get("gateTo");
  if (gf) u.searchParams.set("gateFrom", String(gf));
  if (gt) u.searchParams.set("gateTo", String(gt));
  var sla = sp.get("spawnLat");
  var sln = sp.get("spawnLng");
  if (sla && sln) {
    u.searchParams.set("spawnLat", String(sla));
    u.searchParams.set("spawnLng", String(sln));
  }
  var dbg = String(sp.get("orientaDebug") || sp.get("debug") || "").trim();
  if (/^(1|true|yes)$/i.test(dbg)) u.searchParams.set("orientaDebug", "1");
  var npl = String(sp.get("orientaNavPathLog") || sp.get("navPathLog") || "").trim();
  if (/^(1|true|yes)$/i.test(npl)) u.searchParams.set("orientaNavPathLog", "1");
  var nt = sp.get("navTerminal");
  if (nt) u.searchParams.set("navTerminal", String(nt));
  var nf = sp.get("navFloors") || sp.get("navFloor");
  if (nf) u.searchParams.set("navFloors", String(nf));
  return u.toString();
}

function orientaMountIndoorEmbedInMapPeople_(mapEl, baseUrl, apiBase, tileBase, tileUrl) {
  mapEl.innerHTML = "";
  mapEl.style.position = "relative";
  mapEl.style.flex = "1 1 auto";
  mapEl.style.minHeight = "0";
  var ifr = document.createElement("iframe");
  ifr.id = "orientaRouteSiteIndoorEmbed";
  ifr.setAttribute("title", "室内航站楼地图");
  ifr.style.position = "absolute";
  ifr.style.left = "0";
  ifr.style.top = "0";
  ifr.style.right = "0";
  ifr.style.bottom = "0";
  ifr.style.width = "100%";
  ifr.style.height = "100%";
  ifr.style.minHeight = "200px";
  ifr.style.border = "0";
  ifr.style.display = "block";
  ifr.style.background = "#111";
  var fullSrc = orientaBuildIndoorEmbedSrc_(baseUrl, apiBase, tileBase, tileUrl);
  if (!fullSrc) return;
  var targetOrigin = "*";
  try {
    targetOrigin = new URL(fullSrc).origin;
  } catch (eO) {}
  ifr.src = fullSrc;
  mapEl.appendChild(ifr);
  window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__ = { iframe: ifr, targetOrigin: targetOrigin };
  var __indoorLoaded = false;
  var __indoorEmbedTimeoutId = null;
  /** Slow Tailscale / first hit on `airport-map.html` can exceed a few seconds; too short → false "timeout" → PEK uses Tencent/OSM fallback (no terminal POI). Override: ?indoorEmbedTimeoutMs=15000 */
  var __indoorEmbedTimeoutMs = 12000;
  try {
    var __spTo = new URLSearchParams(location.search);
    var __qTo = parseInt(String(__spTo.get("indoorEmbedTimeoutMs") || ""), 10);
    if (Number.isFinite(__qTo) && __qTo >= 3000 && __qTo <= 120000) __indoorEmbedTimeoutMs = __qTo;
  } catch (eTo) {}
  function orientaFallbackToDefaultPeopleMap_(why) {
    if (__indoorLoaded) return;
    __indoorLoaded = true;
    try {
      if (__indoorEmbedTimeoutId !== null) {
        clearTimeout(__indoorEmbedTimeoutId);
        __indoorEmbedTimeoutId = null;
      }
    } catch (eClr0) {}
    try {
      orientaRouteSiteDebugLog_("[indoor] fallback to local map: " + String(why || "unknown"), true);
    } catch (eF0) {}
    try {
      ifr.remove();
    } catch (eRm) {}
    window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__ = null;
    mapEl.innerHTML = "";
    orientaInitPeopleMapDefault_(mapEl);
  }
  try {
    var br = mapEl.getBoundingClientRect();
    orientaRouteSiteDebugLog_("[indoor] mapPeople box: " + Math.round(br.width) + "×" + Math.round(br.height) + "px");
  } catch (eBr) {}
  try {
    if (location.protocol === "https:" && /^https?:\/\//i.test(fullSrc)) {
      var _ifrU = new URL(fullSrc);
      if (_ifrU.protocol === "http:") {
        orientaRouteSiteDebugLog_(
          "[indoor] HTTPS page + HTTP map iframe → Safari blocks mixed content (blank map). Set VITE_INDOOR_MAP_SAME_ORIGIN=1 and INDOOR_MAP_* proxies in vite/.env, or use an https map URL on this host.",
          true
        );
      }
    }
  } catch (eMc) {}
  orientaRouteSiteDebugLog_("[indoor] iframe src len=" + fullSrc.length + " → " + fullSrc.slice(0, 420));
  ifr.addEventListener("load", function () {
    try {
      if (__indoorEmbedTimeoutId !== null) {
        clearTimeout(__indoorEmbedTimeoutId);
        __indoorEmbedTimeoutId = null;
      }
    } catch (eClrL) {}
    if (__indoorLoaded) return;
    __indoorLoaded = true;
    orientaRouteSiteDebugLog_("[indoor] iframe load event OK");
  });
  ifr.addEventListener("error", function () {
    try {
      if (__indoorEmbedTimeoutId !== null) {
        clearTimeout(__indoorEmbedTimeoutId);
        __indoorEmbedTimeoutId = null;
      }
    } catch (eClrE) {}
    orientaFallbackToDefaultPeopleMap_("iframe error");
  });
  __indoorEmbedTimeoutId = setTimeout(function () {
    __indoorEmbedTimeoutId = null;
    if (__indoorLoaded) return;
    orientaFallbackToDefaultPeopleMap_("iframe load timeout");
  }, __indoorEmbedTimeoutMs);
  orientaScheduleMobileOpenIndoorSheet_();
}

function orientaMountSameOriginIndoorEmbed_(mapEl) {
  orientaRouteSiteDebugLog_("[map] using same-origin bundled airport map");
  orientaMountIndoorEmbedInMapPeople_(
    mapEl,
    orientaApiUrl_("/indoor-map/airport-map.html"),
    orientaApiUrl_("/indoor-map-api"),
    "",
    orientaApiUrl_("/indoor-map/tile/{z}/{x}/{y}.png")
  );
}

function orientaInvalidateIndoorEmbedIfPresent_() {
  var ie = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
  if (!ie || !ie.iframe || !ie.iframe.contentWindow) return;
  try {
    var tgt = ie.targetOrigin === "*" ? "*" : ie.targetOrigin;
    ie.iframe.contentWindow.postMessage({ type: "orienta-map-invalidate" }, tgt);
  } catch (e) {}
}

/** iPhone: map sheet starts collapsed (~26px peek) so the iframe has almost no height → black. Open sheet on phones / coarse pointers after embed mounts. */
function orientaScheduleMobileOpenIndoorSheet_() {
  function poke() {
    orientaInvalidateIndoorEmbedIfPresent_();
  }
  setTimeout(function () {
    try {
      var narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches;
      var coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      if ((narrow || coarse) && typeof setMapOpen === "function") {
        setMapOpen(true);
      }
    } catch (e2) {}
    poke();
  }, 0);
  setTimeout(poke, 450);
  setTimeout(poke, 1200);
}

// Emergency fallback only. Normal passenger map uses bundled airport-map.html via iframe.
let mapPeople = null, peoplePointFeature = null, peoplePathSource = null;
/** Past/future OL line features — updated in place each frame (avoid clear()+re-add flicker). */
var __orientaOlPastFeature = null;
var __orientaOlFutureFeature = null;
/** When true, style hides the full-route line so we do not removeFeature(full) every RAF (that caused strobing). */
var __orientaOlHideFullRoute = false;
let mapPeopleTencent = null, tencentPolylineLayer = null, tencentMarkerLayer = null, useTencentMap = false;
var orientaTencentGljsPromise_ = null;
function orientaGetTencentMapKey_() {
  try {
    var sp = new URLSearchParams(location.search);
    var q = sp.get('tencentKey') || sp.get('tmapKey');
    if (q && String(q).trim()) return String(q).trim();
  } catch (e) {}
  if (typeof window !== 'undefined' && typeof window.TENCENT_MAP_KEY === 'string' && window.TENCENT_MAP_KEY.trim()) {
    return window.TENCENT_MAP_KEY.trim();
  }
  return typeof TENCENT_MAP_KEY !== 'undefined' && TENCENT_MAP_KEY ? String(TENCENT_MAP_KEY).trim() : '';
}
function orientaLoadTencentGljs_(key) {
  if (typeof window.TMap !== 'undefined' && window.TMap.Map) return Promise.resolve();
  if (orientaTencentGljsPromise_) return orientaTencentGljsPromise_;
  orientaTencentGljsPromise_ = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + encodeURIComponent(key);
    s.onload = function() { resolve(); };
    s.onerror = function() { orientaTencentGljsPromise_ = null; reject(new Error('Tencent Map GL script failed')); };
    document.head.appendChild(s);
  });
  return orientaTencentGljsPromise_;
}
function orientaLonLatPathToTMapLatLngs_(path) {
  return path.map(function(c) { return new TMap.LatLng(c[1], c[0]); });
}
function orientaInitPeopleMapDefault_(mapEl) {
  if (!mapEl) return;
  (async function() {
    var pathRef = orientaGetPathLonLat_();
    if (!pathRef || pathRef.length < 2) return;
    const tencentKey = orientaGetTencentMapKey_();
    if (tencentKey) {
      try {
        await orientaLoadTencentGljs_(tencentKey);
        if (typeof TMap !== 'undefined' && TMap.Map && TMap.LatLng && TMap.MultiPolyline && TMap.MultiMarker) {
          const lats = pathRef.map(function(c) { return c[1]; });
          const lons = pathRef.map(function(c) { return c[0]; });
          const minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
          const minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
          const centerLat = (minLat + maxLat) / 2, centerLng = (minLon + maxLon) / 2;
          mapPeopleTencent = new TMap.Map(mapEl, {
            center: new TMap.LatLng(centerLat, centerLng),
            zoom: 16,
          });
          try {
            var sw = new TMap.LatLng(minLat, minLon);
            var ne = new TMap.LatLng(maxLat, maxLon);
            var bounds = new TMap.LatLngBounds(sw, ne);
            mapPeopleTencent.fitBounds(bounds, { padding: 40 });
          } catch (fitE) {}
          tencentPolylineLayer = new TMap.MultiPolyline({
            map: mapPeopleTencent,
            styles: {
              past: new TMap.PolylineStyle({ color: '#606060', width: 4, lineCap: 'round', borderWidth: 0 }),
              future: new TMap.PolylineStyle({ color: '#00c853', width: 4, lineCap: 'round', borderWidth: 0 }),
            },
            geometries: [],
          });
          var pt0 = pathRef[0];
          var arrowIconT = (function() {
            var canvas = document.createElement('canvas');
            canvas.width = 24; canvas.height = 24;
            var ctx = canvas.getContext('2d');
            ctx.translate(12, 12);
            ctx.fillStyle = '#3B82F6'; ctx.strokeStyle = '#1E40AF'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(2, -4); ctx.lineTo(2, 4); ctx.lineTo(-8, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(10, 0); ctx.lineTo(2, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
            return canvas.toDataURL();
          })();
          tencentMarkerLayer = new TMap.MultiMarker({
            map: mapPeopleTencent,
            styles: {
              nav: new TMap.MarkerStyle({ width: 24, height: 24, anchor: { x: 12, y: 12 }, faceTo: 'map', src: arrowIconT }),
            },
            geometries: [{ id: 'nav', styleId: 'nav', position: new TMap.LatLng(pt0[1], pt0[0]) }],
          });
          useTencentMap = true;
          var badgeTencent = document.getElementById('badgeMapP');
          if (badgeTencent) {
            badgeTencent.textContent = '室外地图 · 腾讯地图（PEK）';
          }
          return;
        }
      } catch (e) { try { console.warn('Tencent map init:', e); } catch (_) {} }
    }
    if (typeof ol === 'undefined') return;
    const pathCoords = pathRef.map(function(c){ return ol.proj.fromLonLat(c); });
    __orientaOlPastFeature = null;
    __orientaOlFutureFeature = null;
    peoplePathSource = new ol.source.Vector();
    var fullLineFeat = new ol.Feature({ geometry: new ol.geom.LineString(pathCoords) });
    fullLineFeat.set("type", "full");
    peoplePathSource.addFeature(fullLineFeat);
    const pointSource = new ol.source.Vector();
    const pt = pathRef[0];
    peoplePointFeature = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat(pt)) });
    pointSource.addFeature(peoplePointFeature);
    const arrowIcon = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 24; canvas.height = 24;
      const ctx = canvas.getContext('2d');
      ctx.translate(12, 12);
      ctx.fillStyle = '#3B82F6'; ctx.strokeStyle = '#1E40AF'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(2, -4); ctx.lineTo(2, 4); ctx.lineTo(-8, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(10, 0); ctx.lineTo(2, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      return canvas.toDataURL();
    })();
    peoplePointFeature.set('arrowIcon', arrowIcon);
    peoplePointFeature.set('arrowRotation', 0);
    const arrowStyleFunction = function(feature) {
      const rotation = feature.get('arrowRotation') || 0;
      return new ol.style.Style({ image: new ol.style.Icon({ src: feature.get('arrowIcon') || arrowIcon, anchor: [0.5, 0.5], rotateWithView: true, rotation: rotation }) });
    };
    const pathLayerStyle = function(feature) {
      const t = feature.get('type');
      if (t === 'full' && __orientaOlHideFullRoute) return null;
      const color = t === 'past' ? '#606060' : (t === 'future' ? '#00c853' : '#00c853');
      return new ol.style.Style({ stroke: new ol.style.Stroke({ color: color, width: 4 }) });
    };
    mapPeople = new ol.Map({
      target: 'mapPeople',
      layers: [
        new ol.layer.Tile({ source: new ol.source.OSM() }),
        new ol.layer.Vector({ source: peoplePathSource, style: pathLayerStyle }),
        new ol.layer.Vector({ source: pointSource, style: arrowStyleFunction })
      ],
      view: new ol.View({ center: ol.proj.fromLonLat(pt), zoom: 17 })
    });
    const ext = new ol.geom.LineString(pathCoords).getExtent();
    mapPeople.getView().fit(ext, { padding: [40,40,40,40], maxZoom: 18 });
    requestAnimationFrame(function() {
      try { mapPeople.updateSize(); } catch (eU) {}
      setTimeout(function() { try { mapPeople.updateSize(); } catch (eU2) {} }, 120);
    });
  })();
}

(function orientaInitPeopleMapFromConfig_() {
  var mapEl = document.getElementById("mapPeople");
  if (!mapEl) {
    orientaRouteSiteDebugLog_("[map] #mapPeople missing", true);
    return;
  }
  var sp = new URLSearchParams(location.search);
  var qUrl = (sp.get("indoorMapUrl") || sp.get("orientaIndoorMapUrl") || "").trim();
  var qApi = (sp.get("indoorMapApi") || "").trim();
  var qTile = (sp.get("indoorTileBase") || "").trim();
  var qTileUrl = (sp.get("indoorTileUrl") || "").trim();
  if (qUrl) {
    orientaRouteSiteDebugLog_("[map] using query indoorMapUrl; api/tile from query if set");
    orientaMountIndoorEmbedInMapPeople_(mapEl, qUrl, qApi, qTile, qTileUrl);
    return;
  }
  orientaRouteSiteDebugLog_("[map] fetching GET /api/orienta/route-site-map-embed …");
  fetch(orientaApiUrl_("/api/orienta/route-site-map-embed"))
    .then(function (r) {
      orientaRouteSiteDebugLog_("[map] embed response HTTP " + r.status + " " + (r.ok ? "ok" : "not-ok"));
      return r.json();
    })
    .then(function (cfg) {
      var u = cfg && cfg.url ? String(cfg.url).trim() : "";
      orientaRouteSiteDebugLog_(
        "[map] embed JSON: url=" + (u ? u.slice(0, 120) + (u.length > 120 ? "…" : "") : "(empty)") +
          " apiBase=" + (cfg && cfg.apiBase ? String(cfg.apiBase).slice(0, 80) : "—") +
          " tileBase=" + (cfg && cfg.tileBase ? "set" : "—") +
          " tileUrl=" + (cfg && cfg.tileUrl ? "set" : "—")
      );
      if (u) {
        orientaMountIndoorEmbedInMapPeople_(
          mapEl,
          u,
          cfg.apiBase ? String(cfg.apiBase) : "",
          cfg.tileBase ? String(cfg.tileBase) : "",
          cfg.tileUrl ? String(cfg.tileUrl) : ""
        );
        return;
      }
      orientaRouteSiteDebugLog_("[map] no embed url → same-origin bundled airport map");
      orientaMountSameOriginIndoorEmbed_(mapEl);
    })
    .catch(function (err) {
      orientaRouteSiteDebugLog_("[map] embed fetch failed: " + (err && err.message ? err.message : String(err)), true);
      orientaMountSameOriginIndoorEmbed_(mapEl);
    });
})();



// ---------- zoom controller ----------

// ---------- video/map + recommendation panels ----------
const videoMapContainer = document.getElementById('videoMapContainer');
const videoWrap = document.getElementById('videoWrap');
const PANEL_DRAG_THRESHOLD = 45;
let mapOpen = false;
let recoOpen = false;
let controlsHideTimer = null;

function setControlsVisible(visible, autoHideMs = 0) {
  if (!phoneRoot) return;
  phoneRoot.classList.toggle('controls-visible', !!visible);
  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
  if (visible && autoHideMs > 0) {
    controlsHideTimer = setTimeout(() => {
      phoneRoot.classList.remove('controls-visible');
      controlsHideTimer = null;
    }, autoHideMs);
  }
}

function updateViewportLayout() {
  const vv = window.visualViewport;
  const vh = Math.round(vv ? vv.height : window.innerHeight);
  const vw = Math.round(vv ? vv.width : window.innerWidth);
  const isLandscape = vw > vh;
  const root = document.documentElement;

  var browserUiBottom = 0;
  if (typeof window.__ORIENTA_BROWSER_UI_BOTTOM_FROM_PARENT__ === 'number') {
    browserUiBottom = Math.max(0, window.__ORIENTA_BROWSER_UI_BOTTOM_FROM_PARENT__);
  } else if (vv) {
    browserUiBottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }
  root.style.setProperty('--browser-ui-bottom-inset', browserUiBottom + 'px');

  // Keep a small visible map handle when collapsed.
  root.style.setProperty('--map-peek', (isLandscape ? 20 : 26) + 'px');

  // Dynamic map panel height by orientation (slightly taller sheet = more map).
  const openH = isLandscape
    ? Math.max(150, Math.min(Math.round(vh * 0.66), 340))
    : Math.max(200, Math.min(Math.round(vh * 0.48), 368));
  root.style.setProperty('--map-open-height', openH + 'px');
  root.style.setProperty('--map-min-height', (isLandscape ? 128 : 188) + 'px');

  // Custom .dash overlays bottom of #videoWrap (above map peek); video uses full frame height.
  root.style.setProperty('--video-bottom-reserve', '0px');

  // Recommended stores drawer height adapts by orientation and viewport height.
  const recoMax = isLandscape
    ? Math.max(120, Math.min(Math.round(vh * 0.46), 180))
    : Math.max(150, Math.min(Math.round(vh * 0.34), 240));
  root.style.setProperty('--reco-max-height', recoMax + 'px');
  orientaInvalidateIndoorEmbedIfPresent_();
}

function setMapOpen(open) {
  mapOpen = !!open;
  videoMapContainer.classList.toggle('map-open', mapOpen);
  updateViewportLayout();
  setTimeout(function(){
    if (mapPeopleTencent && typeof mapPeopleTencent.resize === 'function') mapPeopleTencent.resize();
    else if (mapPeople && typeof mapPeople.updateSize === 'function') mapPeople.updateSize();
    else if (window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__ && window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__.iframe && window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__.iframe.contentWindow) {
      try {
        var ie = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
        var tgt = ie.targetOrigin === "*" ? "*" : ie.targetOrigin;
        ie.iframe.contentWindow.postMessage({ type: "orienta-map-invalidate" }, tgt);
      } catch (eInv) {}
    }
  }, 280);
}

function setRecoOpen(open) {
  recoOpen = !!open;
  videoMapContainer.classList.toggle('reco-open', recoOpen);
  updateViewportLayout();
}

// start collapsed
setMapOpen(false);
setRecoOpen(false);
setControlsVisible(false);
updateViewportLayout();
window.addEventListener('resize', updateViewportLayout, { passive: true });
window.addEventListener('orientationchange', updateViewportLayout, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateViewportLayout, { passive: true });
  window.visualViewport.addEventListener('scroll', updateViewportLayout, { passive: true });
}

window.addEventListener('message', function orientaBrowserUiInsetFromParent_(ev) {
  var d = ev && ev.data;
  if (!d || d.type !== 'orienta-browser-ui-inset') return;
  var px = Number(d.bottomPx);
  if (!Number.isFinite(px) || px < 0) px = 0;
  window.__ORIENTA_BROWSER_UI_BOTTOM_FROM_PARENT__ = Math.round(px);
  document.documentElement.style.setProperty('--browser-ui-bottom-inset', Math.round(px) + 'px');
});

// Custom control bar (.dash): hidden until user taps/clicks the screen; auto-hide after idle (like full-screen video UX).
const CONTROLS_AUTO_HIDE_MS = 3400;
const CONTROLS_AUTO_HIDE_MS_SCRUB = 12000;
if (phoneRoot) {
  phoneRoot.addEventListener('pointerdown', function orientaControlsArm(ev) {
    const t = ev.target;
    if (t && t.closest && t.closest('.gate-checkpoint-overlay')) return;
    if (t && t.closest && t.closest('.relocate-poi-overlay')) return;
    const onDash = t && t.closest && t.closest('.dash');
    setControlsVisible(true, onDash ? CONTROLS_AUTO_HIDE_MS_SCRUB : CONTROLS_AUTO_HIDE_MS);
  }, { passive: true });
}

function setupVerticalDrag(el, onDown, onMove, onUp) {
  let ptrId = null, startY = null, startX = null, tracking = false;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 2) return;
    if (onDown && onDown(e) === false) return;
    if (e.button === 2) e.preventDefault();
    tracking = true;
    ptrId = e.pointerId; startY = e.clientY; startX = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.addEventListener('contextmenu', e => { if (e.target === el || el.contains(e.target)) e.preventDefault(); });
  el.addEventListener('pointermove', e => {
    if (!tracking || e.pointerId !== ptrId || startY === null) return;
    const dy = e.clientY - startY, dx = e.clientX - startX;
    if (e.cancelable && (Math.abs(dy) > 4 || Math.abs(dx) > 4)) e.preventDefault();
    if (onMove) onMove(e, dx, dy);
  });
  function end(e) {
    if (!tracking || e.pointerId !== ptrId || startY === null) return;
    const dy = e.clientY - startY, dx = e.clientX - startX;
    if (onUp) onUp(e, dx, dy);
    try { el.releasePointerCapture(e.pointerId); } catch(err){}
    ptrId = null; startY = null; startX = null; tracking = false;
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', e => { if (e.pointerId === ptrId) end(e); });
}

// Video gestures:
// - swipe up/down => open/close map
// - swipe left/right => open/close recommendations (ignored if gesture started on <video> so seeks/controls still work)
let videoWrapGestureFromVideo = false;
setupVerticalDrag(videoWrap, (e) => {
  videoWrapGestureFromVideo = !!(e.target && e.target.tagName === 'VIDEO');
  return true;
}, null, (e, dx, dy) => {
  const fromVideo = videoWrapGestureFromVideo;
  videoWrapGestureFromVideo = false;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > PANEL_DRAG_THRESHOLD) {
    if (fromVideo) return;
    if (dx < 0) setRecoOpen(true);
    if (dx > 0) setRecoOpen(false);
    return;
  }
  if (Math.abs(dy) > PANEL_DRAG_THRESHOLD) {
    if (dy < 0) setMapOpen(true);
    if (dy > 0) setMapOpen(false);
  }
});

// Map sheet vertical gestures (large hit target around drag pill + horizontal padding)
setupVerticalDrag(pager, (e) => {
  if (!mapDragHandle) return false;
  const r = mapDragHandle.getBoundingClientRect();
  const padX = 52;
  const padTop = 14;
  const padBot = 10;
  const inHandleZone =
    e.clientX >= r.left - padX && e.clientX <= r.right + padX &&
    e.clientY >= r.top - padTop && e.clientY <= r.bottom + padBot;
  return inHandleZone;
}, null, (e, dx, dy) => {
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (Math.abs(dy) <= PANEL_DRAG_THRESHOLD) return;
  if (dy < 0) setMapOpen(true);
  if (dy > 0) setMapOpen(false);
});

// Recommendation drawer horizontal gestures
if (amenitiesVideoOverlay) setupVerticalDrag(amenitiesVideoOverlay, null, null, (e, dx, dy) => {
  if (Math.abs(dy) > Math.abs(dx)) return;
  if (Math.abs(dx) <= PANEL_DRAG_THRESHOLD) return;
  if (dx < 0) setRecoOpen(true);
  if (dx > 0) setRecoOpen(false);
});

// ---------- geometry ----------
function totalLength(p){
  let L = 0;
  for (let i=0;i<p.length-1;i++){
    const dx = p[i+1][0]-p[i][0];
    const dy = p[i+1][1]-p[i][1];
    L += Math.hypot(dx,dy);
  }
  return L;
}
function sampleAt(p,d){
  if (d<=0) return p[0];
  let acc=0;
  for (let i=0;i<p.length-1;i++){
    const a=p[i], b=p[i+1];
    const seg=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if (acc+seg>=d){
      const t=(d-acc)/Math.max(1e-6,seg);
      return [a[0]*(1-t)+b[0]*t, a[1]*(1-t)+b[1]*t];
    }
    acc+=seg;
  }
  return p[p.length-1];
}
// Calculate heading from actual arrow position to next point(s) along path

// Calculate heading using distance-based lookahead (same approach for truck and people arrow)



// ---------- timing ----------
let STOP_AT = null;     // seconds (parsed gate time on full video)
let _gateRaf = 0;
let _gateInt = 0;

function computeStopAt(){
  const dur = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
  if (!dur){ STOP_AT = null; return; }

  // If the served video is the extracted segment, its time range [0..dur]
  // should map to the arc-length window [START_S..STOP_S]. In that case
  // the stop time (in the video) is simply the video's duration.
  // Otherwise (full original video) the previous mapping still works.
  // We detect the common case (segment served) by checking whether the
  // STOP_S-START_S spans less than the full path; in all cases using the
  // safer mapping below keeps the time->arc mapping coherent.

  // Stop at the end of the currently loaded video (works for full or
  // truncated videos) — video end corresponds to STOP_S in arc-space.
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    const b = orientaPekClipPlayBoundsForVid_(vid);
    STOP_AT = b && b.tEnd > b.t0 ? b.tEnd : Math.min(__pekClip.t1, dur);
    return;
  }
  STOP_AT = dur;
}

function disarmGateGuards(){
  if (_gateRaf){ cancelAnimationFrame(_gateRaf); _gateRaf = 0; }
  if (_gateInt){ clearInterval(_gateInt); _gateInt = 0; }
  vid.removeEventListener('timeupdate', _gateTick);
}

function _gateTick(){
  if (STOP_AT == null) return;
  if (!isFinite(vid.currentTime)) return;

  // iOS can jump in larger steps; give a small tolerance
  const EPS = 1/30; // ~33ms
  if (vid.currentTime >= STOP_AT - EPS){
    // Important: pause first, then snap time on the next task/microtask
    vid.pause();
    // Defer the seek slightly — fixes some iOS cases where immediate seeking is ignored
    setTimeout(() => { vid.currentTime = STOP_AT; }, 0);
    disarmGateGuards();
  }
}

function armGateGuards(){
  disarmGateGuards();
  if (STOP_AT == null) return;

  // rAF loop — fires often on most devices
  const loop = () => { _gateTick(); _gateRaf = requestAnimationFrame(loop); };
  _gateRaf = requestAnimationFrame(loop);

  // Coarse guard — fires a few times/sec even on iOS
  vid.addEventListener('timeupdate', _gateTick);

  // Backup guard — in case both above are throttled
  _gateInt = setInterval(_gateTick, 80);
}

// (Re)compute when metadata or duration stabilizes
let __orientaClipStartApplied = false;
function orientaApplyInitialClipStart_() {
  if (__orientaClipStartApplied) return;
  if (typeof __pekClip === 'undefined' || !__pekClip || !vid) return;
  var b = orientaPekClipPlayBoundsForVid_(vid);
  var t0 = b && Number.isFinite(b.t0) ? b.t0 : Number(__pekClip.t0);
  if (!Number.isFinite(t0) || t0 < 0) return;
  const canSeek = (Number.isFinite(vid.duration) && vid.duration > 0) || vid.readyState >= 1;
  if (!canSeek) return;
  try {
    // Some browsers ignore an immediate seek until metadata is ready; keep retry hooks below.
    vid.currentTime = t0;
    try {
      vid.pause();
      setPlayPauseLabel();
    } catch (ePause) {}
    __orientaClipStartApplied = true;
    orientaPrimeCheckpointsAtClipStart_(orientaGateCheckpointVideoSec_(t0));
  } catch (e) {}
}
vid.addEventListener('loadedmetadata', () => {
  orientaApplyInitialClipStart_();
  computeStopAt(); armGateGuards();
});
vid.addEventListener('canplay', orientaApplyInitialClipStart_);
vid.addEventListener('durationchange',  () => { computeStopAt(); armGateGuards(); });
// If metadata loaded before listeners were attached, apply immediately.
setTimeout(orientaApplyInitialClipStart_, 0);

// If the device still skips to the end, bring it back to the gate and pause
vid.addEventListener('ended', () => {
  const dur = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
  if (STOP_AT != null && dur && STOP_AT < dur - 1e-3){
    vid.pause();
    // Defer the seek to make it stick on mobile
    setTimeout(() => { vid.currentTime = STOP_AT; }, 0);
  }
});

// If the tab/app comes back into view on mobile, re-arm guards
document.addEventListener('visibilitychange', () => {
  if (!document.hidden){
    computeStopAt();
    armGateGuards();
  }
});



// ---------- controls ----------
const speedSelect = document.getElementById('speedSelect');
const timeSlider  = document.getElementById('timeline');
const playPauseBtn = document.getElementById('playPause');
const timeLabel = document.getElementById('timeLabel');

function fmtClock(sec){
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}
function orientaClampPekVideoTime_() {
  if (typeof __pekClip === 'undefined' || !__pekClip || !vid) return;
  const b = orientaPekClipPlayBoundsForVid_(vid);
  if (!b) return;
  if (vid.currentTime < b.t0) { vid.currentTime = b.t0; return; }
  if (vid.currentTime > b.tEnd) {
    vid.currentTime = b.tEnd;
    if (!vid.paused) vid.pause();
  }
}
function updateTimeLabel(){
  if (!timeLabel) return;
  const cur = Number.isFinite(vid.currentTime) ? vid.currentTime : 0;
  const dur = Number.isFinite(vid.duration) ? vid.duration : 0;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    const b = orientaPekClipPlayBoundsForVid_(vid);
    const t0 = b ? b.t0 : __pekClip.t0;
    const tEnd = b ? b.tEnd : __pekClip.t1;
    const rel = Math.max(0, cur - t0);
    const span = Math.max(0.001, tEnd - t0);
    timeLabel.textContent = `${fmtClock(rel)} / ${fmtClock(span)}`;
    return;
  }
  timeLabel.textContent = `${fmtClock(cur)} / ${fmtClock(dur)}`;
}

function setPlayPauseLabel() {
  if (!playPauseBtn) return;
  playPauseBtn.textContent = vid.paused ? '▶' : '❚❚';
  playPauseBtn.setAttribute('aria-label', vid.paused ? '播放' : '暂停');
}

if (playPauseBtn) playPauseBtn.onclick = async () => {
  if (vid.paused) {
    const dur  = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
    if (STOP_AT == null) computeStopAt();
    armGateGuards();
    const gate = (STOP_AT == null) ? dur : STOP_AT;
    if (dur && vid.currentTime >= gate - 1e-3){
      vid.currentTime = gate;
      setPlayPauseLabel();
      return;
    }
    try { await vid.play(); } catch (_) {}
  } else {
    vid.pause();
  }
  setPlayPauseLabel();
};
vid.addEventListener('play', setPlayPauseLabel);
vid.addEventListener('pause', setPlayPauseLabel);
vid.addEventListener('timeupdate', () => { orientaClampPekVideoTime_(); updateTimeLabel(); });
vid.addEventListener('loadedmetadata', updateTimeLabel);
vid.addEventListener('seeking', orientaClampPekVideoTime_);
vid.addEventListener('seeked', orientaClampPekVideoTime_);
setPlayPauseLabel();
updateTimeLabel();

// Fixed speed presets (YouTube-like)
if (speedSelect) speedSelect.onchange = () => {
  const rate = parseFloat(speedSelect.value || '1');
  vid.playbackRate = Number.isFinite(rate) ? rate : 1.0;
};

// scrubber: people page timeline
let scrubbing = false;
timeSlider.addEventListener('input', () => {
  scrubbing = true;
  if (isFinite(vid.duration) && vid.duration > 0){
    const T = vid.duration;
    const tGate = STOP_AT || T;
    let target;
    if (typeof __pekClip !== 'undefined' && __pekClip) {
      const b = orientaPekClipPlayBoundsForVid_(vid);
      const t0 = b ? b.t0 : __pekClip.t0;
      const tEnd = b ? b.tEnd : __pekClip.t1;
      const span = Math.max(1e-6, tEnd - t0);
      target = t0 + (parseFloat(timeSlider.value) / 1000) * span;
      if (target > tGate) target = tGate;
    } else {
      target = (parseFloat(timeSlider.value) / 1000) * T;
      if (target > tGate) target = tGate;
    }
    vid.currentTime = target;
    if (target >= tGate - 1e-3) vid.pause();
  }
});
timeSlider.addEventListener('change', () => { scrubbing = false; });


// ---------- draw loops ----------
var __orientaPdrNextPoiIdx_ = 0;
var __orientaPdrLastPoiSnapMs_ = 0;
/** 重定位/裁切后：当前视频本地秒 ↔ 当时 PDR 累计步行米，避免从 0m 把片头时间拉回 */
var __orientaPdrVideoSyncAnchor_ = null;
function orientaGetPdrVideoRouteMeters_() {
  var routeMeters = 480;
  try {
    var spVid = new URLSearchParams(location.search);
    var qMeters = Number(spVid.get('pdrVideoMeters') || spVid.get('pdrRouteMeters'));
    if (isFinite(qMeters) && qMeters > 5) routeMeters = qMeters;
  } catch (eQm) {}
  return routeMeters;
}
function orientaPdrVideoSyncClipKey_() {
  if (typeof __pekClip === 'undefined' || !__pekClip) return 'full';
  return (
    String(__pekClip.timeline || 'merged') +
    ':' +
    __pekClip.fromIdx +
    '-' +
    __pekClip.toIdx
  );
}
function orientaRefreshPdrVideoSyncAnchor_(optPdrDistM) {
  if (!vid) return;
  var pdrDistM = 0;
  if (Number.isFinite(optPdrDistM)) pdrDistM = Number(optPdrDistM);
  else {
    try {
      var st =
        window.__ORIENTA_PDR__ && window.__ORIENTA_PDR__.getState && window.__ORIENTA_PDR__.getState();
      var pose = st && st.lastPose;
      if (pose && isFinite(pose.distanceM)) pdrDistM = Number(pose.distanceM);
    } catch (eP) {}
  }
  var videoLocal = orientaGateCheckpointVideoSec_(vid.currentTime);
  if (!Number.isFinite(videoLocal)) videoLocal = 0;
  __orientaPdrVideoSyncAnchor_ = {
    clipKey: orientaPdrVideoSyncClipKey_(),
    videoLocalSec: Math.max(0, videoLocal),
    pdrDistM: Math.max(0, pdrDistM),
    at: Date.now(),
  };
}
function orientaMapPoiCheckpointRadiusM_() {
  try {
    var sp = new URLSearchParams(location.search);
    var q = Number(sp.get('mapPoiCheckpointM') || sp.get('pdrPoiCheckpointM'));
    if (isFinite(q) && q > 1) return q;
  } catch (e) {}
  return 5;
}
function orientaMapPoiCheckpointEnabled_() {
  return orientaReadBoolParam_('mapPoiCheckpoint', true);
}
function orientaDistLngLatM_(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return null;
  if (typeof ol !== 'undefined') {
    try {
      var proj3857b = ol.proj.get('EPSG:3857');
      var pp = ol.proj.fromLonLat(a, proj3857b);
      var qq = ol.proj.fromLonLat(b, proj3857b);
      return Math.hypot(pp[0] - qq[0], pp[1] - qq[1]);
    } catch (eD) {}
  }
  return orientaHaversineM_(a, b);
}
function orientaNavStepIsRoutePoi_(step) {
  if (!step || typeof step !== 'object') return false;
  var cat = String(step.category || '').toLowerCase();
  return cat === 'gate' || cat === 'security';
}
function orientaBuildRoutePoisFromNavSteps_() {
  var path = window.__ORIENTA_PATH_LONLAT_FROM_MAP__;
  var steps = window.__ORIENTA_NAV_PATH_STEPS__;
  var out = [];
  if (!steps || !path || path.length < 2) return out;
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    if (!orientaNavStepIsRoutePoi_(s)) continue;
    var idx = Number(s.i);
    if (!Number.isFinite(idx) || idx < 0 || idx >= path.length) continue;
    var ll = path[idx];
    if (!ll || ll.length < 2 || !isFinite(ll[0]) || !isFinite(ll[1])) continue;
    out.push({
      name: String(s.name || '').trim() || String(s.id || ''),
      category: String(s.category || ''),
      lngLat: [Number(ll[0]), Number(ll[1])],
    });
  }
  return out;
}
function orientaBuildRoutePoisFromGateCheckpoints_() {
  var out = [];
  if (!GATE_CHECKPOINTS || !GATE_CHECKPOINTS.length) return out;
  for (var gi = 0; gi < GATE_CHECKPOINTS.length; gi++) {
    var g = GATE_CHECKPOINTS[gi];
    if (!g || !g.gate) continue;
    var key = orientaNormalizeGate_(g.gate);
    var ll = orientaLookupPekEGateLngLat_(key, g.floor);
    if (!ll) continue;
    out.push({ name: g.gate, category: /security|checkpoint/i.test(key) ? 'security' : 'gate', lngLat: ll, segmentTime: g.segmentTime });
  }
  return out;
}
function orientaGetRoutePoisForMapCheckpoint_() {
  var nav = orientaBuildRoutePoisFromNavSteps_();
  if (nav.length) return nav;
  return orientaBuildRoutePoisFromGateCheckpoints_();
}
function orientaCheckMapPoiProximityCheckpoint_(dotLngLat) {
  if (!orientaMapPoiCheckpointEnabled_() || AUTO_GATE_CONTINUE) return;
  if (!dotLngLat || dotLngLat.length < 2) return;
  if (typeof __pekClip !== 'undefined' && __pekClip && !__orientaClipStartApplied) return;
  if (!orientaPekVideoReadyForGateCheckpoints_()) return;
  if (vid) {
    var tMap = orientaGateCheckpointVideoSec_(vid.currentTime);
    if (!Number.isFinite(tMap) || tMap < 0.12) return;
  }
  if (gateCheckpointOverlay && gateCheckpointOverlay.classList.contains('visible')) return;
  if (gateWhichGateOverlay && gateWhichGateOverlay.classList.contains('visible')) return;
  var pois = orientaGetRoutePoisForMapCheckpoint_();
  if (!pois.length) return;
  if (__orientaPdrNextPoiIdx_ < 0) __orientaPdrNextPoiIdx_ = 0;
  if (__orientaPdrNextPoiIdx_ >= pois.length) return;
  var poiKey = String(__orientaPdrNextPoiIdx_);
  if (__orientaMapPoiCheckpointTriggered_.has(poiKey)) return;
  var poi = pois[__orientaPdrNextPoiIdx_];
  if (!poi || !poi.lngLat) return;
  var dM = orientaDistLngLatM_(dotLngLat, poi.lngLat);
  if (dM == null || !isFinite(dM) || dM > orientaMapPoiCheckpointRadiusM_()) return;
  __orientaMapPoiCheckpointTriggered_.add(poiKey);
  try {
    var poiNorm = orientaNormalizeGate_(poi.name);
    for (var vi = 0; vi < GATE_CHECKPOINTS.length; vi++) {
      if (orientaNormalizeGate_(GATE_CHECKPOINTS[vi].gate) === poiNorm) gateCheckpointTriggered.add(vi);
    }
  } catch (eSyncVid) {}
  var segTime = poi.segmentTime != null ? poi.segmentTime : null;
  if (vid) {
    try { vid.pause(); } catch (ePause) {}
    setPlayPauseLabel();
  }
  showGateCheckpointModal(poi.name, segTime, poi.category);
}
function orientaReadBoolParam_(name, defVal) {
  try {
    var sp = new URLSearchParams(location.search);
    var v = String(sp.get(name) || '').trim();
    if (/^(0|false|no|off)$/i.test(v)) return false;
    if (/^(1|true|yes|on)$/i.test(v)) return true;
  } catch (e) {}
  return !!defVal;
}
function orientaGetPdrLngLat_() {
  try {
    if (!window.__ORIENTA_PDR__ || !window.__ORIENTA_PDR__.active) return null;
    var st = window.__ORIENTA_PDR__.getState && window.__ORIENTA_PDR__.getState();
    var ll = st && st.markerLngLat;
    if (ll && ll.length >= 2 && isFinite(ll[0]) && isFinite(ll[1])) return [Number(ll[0]), Number(ll[1])];
  } catch (e) {}
  return null;
}
function orientaUpdatePdrRelocateBtn_() {
  var btn = document.getElementById('btnPdrRelocate');
  if (!btn) return;
  btn.disabled = false;
}
function orientaCurrentPekVideoStem_() {
  try {
    var bn = String(window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ || '').trim();
    if (!bn) {
      var v = document.getElementById('vid');
      if (v && v.src) bn = String(v.src).split('/').pop().split('?')[0] || '';
    }
    return bn.replace(/\.(mp4|MP4)$/i, '');
  } catch (e) {
    return '';
  }
}
function orientaParsePekRelocateCsvText_(text) {
  var rows = [];
  var lines = String(text || '')
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);
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
      poi: poi,
      gate: orientaNormPekPoiKey_(poi) || orientaNormPekCsvGate_(poi),
      floor: floor,
      video: video,
      videoStem: video.replace(/\.(mp4|MP4)$/i, ''),
      segmentTime: sec,
      timeLabel: timePart,
    });
  }
  return rows;
}
function orientaLookupPoiLngLatFromNavSteps_(poiRaw) {
  try {
    var steps = window.__ORIENTA_NAV_PATH_STEPS__;
    var pl = orientaGetPathLonLat_();
    if (!Array.isArray(steps) || !pl || pl.length < 2) return null;
    var want = orientaNormPekCsvGate_(poiRaw);
    if (!want) want = orientaNormalizeGate_(poiRaw);
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (!s) continue;
      var nm = orientaNormPekCsvGate_(s.name || s.id || '');
      if (!nm) nm = orientaNormalizeGate_(s.name || s.id || '');
      if (nm !== want && nm.indexOf(want) < 0 && want.indexOf(nm) < 0) continue;
      var idx = Number(s.i);
      if (!Number.isFinite(idx) || idx < 0 || idx >= pl.length) continue;
      var ll = pl[idx];
      if (ll && ll.length >= 2 && isFinite(ll[0]) && isFinite(ll[1])) return [Number(ll[0]), Number(ll[1])];
    }
  } catch (e) {}
  return null;
}
function orientaLookupPekPoiLngLat_(gateNorm, poiRaw, preferFloor) {
  var ll = orientaLookupPekEGateLngLat_(gateNorm, preferFloor);
  if (ll) return ll;
  return orientaLookupPoiLngLatFromNavSteps_(poiRaw || gateNorm);
}
function orientaGetPekRouteToGate_() {
  if (typeof __pekClip !== 'undefined' && __pekClip && __pekClip.toGate) {
    return orientaNormalizeGate_(__pekClip.toGate);
  }
  try {
    var sp = new URLSearchParams(location.search);
    var tg = orientaNormalizeGate_(sp.get('to') || sp.get('dest') || sp.get('destination') || sp.get('gateTo') || '');
    if (tg) return tg;
  } catch (e) {}
  return '';
}
function orientaEnsurePekRowsGlobalClipTimeFull_() {
  if (!__pekRows || !__pekRows.length) return;
  orientaAugmentPekRowsGlobalClipTime_(__pekRows, { fromIdx: 0, toIdx: __pekRows.length - 1 });
}
function orientaFindPekRowIndexForRelocate_(row) {
  if (!__pekRows || !row) return -1;
  orientaEnsurePekRowsGlobalClipTimeFull_();
  var gate = orientaNormalizeGate_(row.gate);
  var floor = String(row.floor || '').trim().toUpperCase();
  var stem = String(row.videoStem || row.video || '')
    .trim()
    .replace(/\.(mp4|MP4)$/i, '');
  var segT = Number(row.segmentTime);
  for (var i = 0; i < __pekRows.length; i++) {
    var r = __pekRows[i];
    if (orientaNormalizeGate_(r.gate) !== gate) continue;
    if (floor && String(r.floor || '').trim().toUpperCase() !== floor) continue;
    var rs = String(r.video || '').replace(/\.(mp4|MP4)$/i, '');
    if (stem && rs !== stem) continue;
    if (Number.isFinite(segT) && Math.abs(Number(r.segmentTime) - segT) > 0.08) continue;
    return i;
  }
  for (var j = __pekRows.length - 1; j >= 0; j--) {
    var r2 = __pekRows[j];
    if (orientaNormalizeGate_(r2.gate) !== gate) continue;
    if (floor && String(r2.floor || '').trim().toUpperCase() !== floor) continue;
    return j;
  }
  return -1;
}
function orientaFindPekRowIndexForward_(gate, afterIdx) {
  if (!__pekRows) return -1;
  var g = orientaNormalizeGate_(gate);
  if (!g) return -1;
  var start = Math.max(0, Number(afterIdx) || 0);
  for (var i = start; i < __pekRows.length; i++) {
    if (orientaNormalizeGate_(__pekRows[i].gate) === g) return i;
  }
  for (var j = __pekRows.length - 1; j >= 0; j--) {
    if (orientaNormalizeGate_(__pekRows[j].gate) === g) return j;
  }
  return -1;
}
function orientaPekRowVideoBasename_(row) {
  if (!row) return '';
  var vn = String(row.video || '').trim();
  if (!vn) return '';
  var base = vn.replace(/\\/g, '/').split('/').pop() || vn;
  if (!/\.mp4$/i.test(base)) base = base + '.mp4';
  return base;
}
function orientaPekRowsShareVideoBasename_(fromIdx, toIdx) {
  if (!__pekRows || fromIdx < 0 || toIdx <= fromIdx) return '';
  var first = orientaPekRowVideoBasename_(__pekRows[fromIdx]);
  if (!first) return '';
  for (var i = fromIdx; i <= toIdx; i++) {
    if (orientaPekRowVideoBasename_(__pekRows[i]) !== first) return '';
  }
  return first;
}
function orientaPekClipLocalSegTimeForRow_(r) {
  if (!r) return 0;
  var mode = orientaPekClipTimelineMode_();
  if (mode === 'segment') return Number(r.segmentTime);
  if (mode === 'dynamic') {
    var off = Number(__pekClip && __pekClip.clipTimeOffset);
    if (r.globalClipT != null && Number.isFinite(r.globalClipT) && Number.isFinite(off)) {
      return Number(r.globalClipT) - off;
    }
    return Number(r.segmentTime);
  }
  if (r.globalClipT != null && Number.isFinite(r.globalClipT)) return Number(r.globalClipT);
  return Number(r.segmentTime);
}
function orientaRebuildRouteGateSegmentsFromClip_() {
  if (!__pekRows || !__pekRows.length) return;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    ROUTE_GATE_SEGMENTS = __pekRows.slice(__pekClip.fromIdx, __pekClip.toIdx + 1).map(function (r) {
      return { gate: r.gate, segmentTime: orientaPekClipLocalSegTimeForRow_(r), floor: r.floor };
    });
    GATE_CHECKPOINTS = __pekRows.slice(__pekClip.fromIdx + 1, __pekClip.toIdx + 1).map(function (r) {
      return { gate: r.gate, segmentTime: orientaPekClipLocalSegTimeForRow_(r), floor: r.floor };
    });
    SEGMENT_DURATION = Math.max(60, (__pekClip.t1 - __pekClip.t0) + 90);
  }
  try {
    gateToSegmentTime = buildGateToSegmentTimeMap();
  } catch (eGt) {}
}
function orientaRefreshPekClipDerivedState_() {
  if (!__pekRows || !__pekClip) return;
  __pekFloorSwitchTimeFrac = orientaComputePekFloorSwitchTimeFrac_(__pekRows, __pekClip);
  __orientaPekClipFloorMode_ = orientaComputePekClipFloorMode_(__pekRows, __pekClip);
  __orientaPekFloorSwitchLocalSec_ = orientaPekFloorSwitchLocalSec_(__pekRows, __pekClip);
  __orientaGateSegmentDistanceCache_ = null;
  if (__orientaPekClipFloorMode_ === 'L3_ONLY') __orientaPekHystWantL3 = true;
  else if (__orientaPekClipFloorMode_ === 'L2_ONLY') __orientaPekHystWantL3 = false;
  orientaRebuildRouteGateSegmentsFromClip_();
  try {
    gateCheckpointTriggered.clear();
    __orientaMapPoiCheckpointTriggered_.clear();
    if (vid && __orientaClipStartApplied) {
      orientaPrimeCheckpointsAtClipStart_(orientaGateCheckpointVideoSec_(vid.currentTime));
    }
  } catch (eClr) {}
}
/** 路线裁切落在同一 CSV video 列时：播对应分段 mp4 + 段内时间，不用 merged 母带时间轴 */
function orientaApplyPekRouteVideoForClip_(fromIdx, toIdx, opts) {
  opts = opts || {};
  if (!__pekRows || !vid || fromIdx < 0 || toIdx <= fromIdx) return false;
  var sharedBn = orientaPekRowsShareVideoBasename_(fromIdx, toIdx);
  var forceSegment = opts.forceSegment !== false;
  if (!forceSegment || !sharedBn || !orientaPekProbeStaticOkSync_(sharedBn)) return false;
  var t0 = Number(__pekRows[fromIdx].segmentTime);
  var t1 = Number(__pekRows[toIdx].segmentTime);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return false;
  var prev = __pekClip || {};
  __pekClip = {
    timeline: 'segment',
    video: sharedBn,
    t0: t0,
    t1: t1,
    fromGate: prev.fromGate || orientaNormalizeGate_(__pekRows[fromIdx].gate),
    toGate: prev.toGate || orientaNormalizeGate_(__pekRows[toIdx].gate),
    fromIdx: fromIdx,
    toIdx: toIdx,
  };
  try {
    window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ = sharedBn;
  } catch (eBn) {}
  __orientaClipStartApplied = false;
  try {
    gateCheckpointTriggered.clear();
    __orientaMapPoiCheckpointTriggered_.clear();
    } catch (eR) {}
  orientaRefreshPekClipDerivedState_();
  var badge = document.getElementById('badgeVideo');
  if (badge) badge.textContent = '首都机场 T3E · ' + sharedBn.replace(/\.mp4$/i, '');
  vid.src = sharedBn + '?t=' + Date.now();
  var seekAfter = opts.afterSeekRow || null;
  var onMeta = function () {
    vid.removeEventListener('loadedmetadata', onMeta);
    try {
      orientaApplyInitialClipStart_();
      if (seekAfter) orientaSeekVideoToRelocateRow_(seekAfter);
      else {
        orientaPrimeCheckpointsAtClipStart_(orientaGateCheckpointVideoSec_(vid.currentTime));
        orientaRefreshPdrVideoSyncAnchor_(0);
      }
      computeStopAt();
      armGateGuards();
      orientaLastTouristPushMs_ = 0;
      pushTouristPositionToBackend();
    } catch (eM) {}
  };
  vid.addEventListener('loadedmetadata', onMeta);
  return true;
}
/** 跨多个 CSV video 列时：按行索引 ffmpeg 拼接，时间轴从 fromIdx 归零 */
function orientaApplyPekDynamicMergedVideoForClip_(fromIdx, toIdx, opts) {
  opts = opts || {};
  if (!__pekRows || !vid || fromIdx < 0 || toIdx <= fromIdx) return false;
  orientaEnsurePekRowsGlobalClipTimeFull_();
  var gt0 = Number(__pekRows[fromIdx].globalClipT);
  var gt1 = Number(__pekRows[toIdx].globalClipT);
  if (!Number.isFinite(gt0) || !Number.isFinite(gt1) || !(gt1 > gt0)) return false;
  var url = orientaPickPekDynamicMergedFromApiSync_(fromIdx, toIdx);
  if (!url) return false;
  var bn = url.replace(/\\/g, '/').split('/').pop() || '';
  var prev = __pekClip || {};
  __pekClip = {
    timeline: 'dynamic',
    dynamicUrl: url,
    clipTimeOffset: gt0,
    t0: 0,
    t1: gt1 - gt0,
    fromGate: prev.fromGate || orientaNormalizeGate_(__pekRows[fromIdx].gate),
    toGate: prev.toGate || orientaNormalizeGate_(__pekRows[toIdx].gate),
    fromIdx: fromIdx,
    toIdx: toIdx,
  };
  try {
    window.__ORIENTA_PEK_VIDEO_SOURCE_BASENAME__ = bn;
  } catch (eBn) {}
  __orientaClipStartApplied = false;
  try {
    gateCheckpointTriggered.clear();
    __orientaMapPoiCheckpointTriggered_.clear();
    } catch (eR) {}
  orientaRefreshPekClipDerivedState_();
  var badge = document.getElementById('badgeVideo');
  if (badge) badge.textContent = '首都机场 T3E · 路线裁切';
  vid.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  var seekAfter = opts.afterSeekRow || null;
  var onMeta = function () {
    vid.removeEventListener('loadedmetadata', onMeta);
    try {
      orientaApplyInitialClipStart_();
      if (seekAfter) orientaSeekVideoToRelocateRow_(seekAfter);
      else {
        orientaPrimeCheckpointsAtClipStart_(orientaGateCheckpointVideoSec_(vid.currentTime));
        orientaRefreshPdrVideoSyncAnchor_(0);
      }
      computeStopAt();
      armGateGuards();
      orientaLastTouristPushMs_ = 0;
      pushTouristPositionToBackend();
    } catch (eM) {}
  };
  vid.addEventListener('loadedmetadata', onMeta);
  return true;
}
function orientaApplyPekRouteVideoMergedFallback_(fromIdx, toIdx) {
  if (!__pekRows || fromIdx < 0 || toIdx <= fromIdx) return false;
  orientaEnsurePekRowsGlobalClipTimeFull_();
  var gt0 = Number(__pekRows[fromIdx].globalClipT);
  var gt1 = Number(__pekRows[toIdx].globalClipT);
  if (!Number.isFinite(gt0) || !Number.isFinite(gt1) || !(gt1 > gt0)) return false;
  var prev = __pekClip || {};
  __pekClip = {
    timeline: 'merged',
    t0: gt0,
    t1: gt1,
    fromGate: prev.fromGate || orientaNormalizeGate_(__pekRows[fromIdx].gate),
    toGate: prev.toGate || orientaNormalizeGate_(__pekRows[toIdx].gate),
    fromIdx: fromIdx,
    toIdx: toIdx,
  };
  orientaRefreshPekClipDerivedState_();
  return true;
}
function orientaRebuildPekMapPathForClip_() {
  var pl = orientaBuildPekPathLonLatFromLandmarks_();
  if (pl && pl.length >= 2) window.__ORIENTA_PATH_LONLAT_FROM_MAP__ = pl;
}
function orientaRequestIndoorNavRerun_(fromGate, toGate, preferFloor) {
  var emb = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
  if (!emb || !emb.iframe || !emb.iframe.contentWindow) return;
  var tgt = emb.targetOrigin === '*' ? '*' : emb.targetOrigin;
  var fk = orientaPekFloorStorageKey_(preferFloor);
  var navFloors = fk === 'L2' ? 'L2' : fk === 'L3' ? 'L3' : '';
  try {
    emb.iframe.contentWindow.postMessage(
      {
        type: 'orienta-indoor-nav-rerun',
        gateFrom: orientaNormalizeGate_(fromGate),
        gateTo: orientaNormalizeGate_(toGate),
        navFloors: navFloors,
        floor: fk || '',
      },
      tgt
    );
  } catch (eNav) {}
}
/** 重定位：从该 POI 裁切到目的地；优先 CSV 分段视频 + 段内时间 */
function orientaApplyPekRelocateSlice_(row) {
  if (!__pekRows || !row) return false;
  var toGate = orientaGetPekRouteToGate_();
  if (!toGate) return false;
  var fromIdx = orientaFindPekRowIndexForRelocate_(row);
  if (fromIdx < 0) return false;
  var toIdx = orientaFindPekRowIndexForward_(toGate, fromIdx);
  if (toIdx < 0 || toIdx <= fromIdx) return false;
  var fromGate = orientaNormalizeGate_(__pekRows[fromIdx].gate);
  __pekClip = __pekClip || {};
  __pekClip.fromGate = fromGate;
  __pekClip.toGate = toGate;
  __pekClip.fromIdx = fromIdx;
  __pekClip.toIdx = toIdx;
  if (orientaApplyPekRouteVideoForClip_(fromIdx, toIdx, { forceSegment: true, afterSeekRow: row })) {
    orientaRebuildPekMapPathForClip_();
    var fl = String(row.floor || '');
    orientaRequestIndoorNavRerun_(fromGate, toGate, fl);
    return 'segment';
  }
  if (orientaApplyPekDynamicMergedVideoForClip_(fromIdx, toIdx, { afterSeekRow: row })) {
    orientaRebuildPekMapPathForClip_();
    var flDyn = String(row.floor || '');
    orientaRequestIndoorNavRerun_(fromGate, toGate, flDyn);
    return 'dynamic';
  }
  orientaApplyPekRouteVideoMergedFallback_(fromIdx, toIdx);
  orientaRebuildPekMapPathForClip_();
  var fl2 = String(row.floor || '');
  orientaRequestIndoorNavRerun_(fromGate, toGate, fl2);
  return 'merged';
}
function orientaRelocateRowVideoSeekSec_(row) {
  var idx = orientaFindPekRowIndexForRelocate_(row);
  if (idx >= 0 && __pekRows && orientaPekClipTimelineMode_() === 'dynamic') {
    return orientaGateCheckpointVideoTimeFromSeg_(orientaPekClipLocalSegTimeForRow_(__pekRows[idx]));
  }
  if (idx >= 0 && __pekRows && orientaPekClipTimelineMode_() === 'segment') {
    return orientaGateCheckpointVideoTimeFromSeg_(Number(__pekRows[idx].segmentTime));
  }
  if (orientaPekClipTimelineMode_() === 'segment' && Number.isFinite(row.segmentTime)) {
    return orientaGateCheckpointVideoTimeFromSeg_(Number(row.segmentTime));
  }
  orientaEnsurePekRowsGlobalClipTimeFull_();
  if (idx >= 0 && __pekRows[idx].globalClipT != null && Number.isFinite(__pekRows[idx].globalClipT)) {
    return orientaGateCheckpointVideoTimeFromSeg_(Number(__pekRows[idx].globalClipT));
  }
  return orientaGateCheckpointVideoTimeFromSeg_(row.segmentTime);
}
function orientaRelocatePoiRowHasCoords_(row) {
  return !!(row && orientaLookupPekPoiLngLat_(row.gate, row.poi, row.floor));
}
function orientaRelocatePoiUpdateSelectionUi_() {
  var row = __orientaRelocatePoiSelectedRow_;
  if (relocatePoiSelected) {
    relocatePoiSelected.textContent = row
      ? '已选：' +
          row.poi +
          ' · ' +
          row.floor +
          ' · ' +
          (row.mergedTimeLabel ? '合并 ' + row.mergedTimeLabel : row.timeLabel) +
          (orientaGetPekRouteToGate_() ? ' → ' + orientaGetPekRouteToGate_() : '')
      : '请先点选一项';
  }
  if (relocatePoiConfirm) {
    relocatePoiConfirm.disabled = !row;
  }
}
function orientaRelocatePoiSelectRow_(row, btnEl) {
  __orientaRelocatePoiSelectedRow_ = row || null;
  if (relocatePoiList) {
    var items = relocatePoiList.querySelectorAll('.relocate-poi-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('selected');
    }
  }
  if (btnEl) btnEl.classList.add('selected');
  orientaRelocatePoiUpdateSelectionUi_();
}
function orientaSeekVideoToRelocateRow_(row) {
  if (!vid || !row) return;
  var seekT = orientaRelocateRowVideoSeekSec_(row);
  var dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
  if (typeof __pekClip !== 'undefined' && __pekClip) {
    try {
      var b = orientaPekClipPlayBoundsForVid_(vid);
      if (b && b.tEnd > b.t0) seekT = Math.max(b.t0, Math.min(b.tEnd, seekT));
    } catch (eClip) {}
  }
  vid.currentTime = dur ? Math.max(0, Math.min(seekT, dur)) : Math.max(0, seekT);
  try {
    vid.pause();
  } catch (ePause) {}
  setPlayPauseLabel();
  try {
    updateTimeLabel();
  } catch (eLbl) {}
  orientaLastTouristPushMs_ = 0;
  try {
    orientaResetRouteProgressTriggersFromVideoSec_(orientaGateCheckpointVideoSec_(seekT));
  } catch (eReset) {}
  try {
    checkGateCheckpoint(seekT);
  } catch (eChk) {}
  try {
    pushTouristPositionToBackend();
  } catch (ePush) {}
  orientaRefreshPdrVideoSyncAnchor_(0);
}
function orientaMapSplitFromLngLatOnPath_(lngLat) {
  var pl = orientaGetPathLonLat_();
  if (!pl || pl.length < 2 || !lngLat || lngLat.length < 2) return null;
  try {
    var proj = orientaProjectPointToPath3857_(lngLat, pl);
    if (!proj || !isFinite(proj.sM)) return null;
    var totalM = 0;
    if (typeof ol !== 'undefined') {
      var proj3857 = ol.proj.get('EPSG:3857');
      for (var si = 0; si < pl.length - 1; si++) {
        var ca = ol.proj.fromLonLat(pl[si], proj3857);
        var cb = ol.proj.fromLonLat(pl[si + 1], proj3857);
        totalM += Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
      }
    }
    var u = totalM > 1e-6 ? Math.max(0, Math.min(1, proj.sM / totalM)) : 0;
    var ms = orientaMapSplitFromPathProgress_(pl, u, DOT_START_OFFSET, DOT_END_OFFSET);
    if (ms && orientaCoordFiniteLngLat_(ms.coord)) return ms;
  } catch (e) {}
  return {
    coord: [Number(lngLat[0]), Number(lngLat[1])],
    pastCoords: [[Number(lngLat[0]), Number(lngLat[1])]],
    futureCoords: [[Number(lngLat[0]), Number(lngLat[1])]],
    si: 0,
    tt: 0,
    b: [Number(lngLat[0]), Number(lngLat[1])],
    n: 1,
  };
}
/** PDR heading if active; else tangent along indoor path at lng/lat. */
function orientaResolveRelocateHeadingRad_(lngLat) {
  try {
    if (window.__ORIENTA_PDR__ && window.__ORIENTA_PDR__.active) {
      var st = window.__ORIENTA_PDR__.getState && window.__ORIENTA_PDR__.getState();
      if (st && st.headingRad != null && isFinite(st.headingRad)) return st.headingRad;
      if (st && st.lastPose && isFinite(st.lastPose.headingDeg)) {
        return ((Number(st.lastPose.headingDeg) - 90) * Math.PI) / 180;
      }
    }
  } catch (ePdr) {}
  var pl = orientaGetPathLonLat_();
  if (!pl || pl.length < 2) return null;
  var ms = orientaMapSplitFromLngLatOnPath_(lngLat);
  if (!ms) return null;
  return orientaHeadingRadAlongSplitMs_(ms, pl);
}
function orientaHeadingDegFromRad_(headingRad) {
  if (headingRad == null || !isFinite(headingRad)) return null;
  var deg = (headingRad * 180) / Math.PI + 90;
  deg = deg % 360;
  if (deg < 0) deg += 360;
  return deg;
}
function orientaSyncPdrNextPoiIdxForGate_(gateNorm) {
  var pois = orientaGetRoutePoisForMapCheckpoint_();
  if (!pois || !pois.length) return;
  var g = orientaNormalizeGate_(gateNorm);
  for (var i = 0; i < pois.length; i++) {
    if (orientaNormalizeGate_(pois[i].name) === g) {
      __orientaPdrNextPoiIdx_ = Math.min(pois.length, i + 1);
      return;
    }
  }
}
function orientaHideRelocatePoiPicker_() {
  if (!relocatePoiOverlay) return;
  relocatePoiOverlay.classList.remove('visible');
  relocatePoiOverlay.setAttribute('aria-hidden', 'true');
  __orientaRelocatePoiSelectedRow_ = null;
  __orientaRelocatePoiListRows_ = [];
  orientaRelocatePoiUpdateSelectionUi_();
}
function orientaRenderRelocatePoiList_(rows) {
  if (!relocatePoiList) return;
  relocatePoiList.innerHTML = '';
  __orientaRelocatePoiSelectedRow_ = null;
  orientaRelocatePoiUpdateSelectionUi_();
  for (var i = 0; i < rows.length; i++) {
    (function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'relocate-poi-item';
      btn.setAttribute('role', 'option');
      if (!orientaRelocatePoiRowHasCoords_(row)) btn.classList.add('no-coord');
      var coordHint = orientaRelocatePoiRowHasCoords_(row) ? '' : ' · 无地图坐标';
      var tLbl = row.mergedTimeLabel
        ? '合并 ' + row.mergedTimeLabel + ' · 段内 ' + row.timeLabel
        : row.timeLabel;
      btn.textContent = row.poi + ' · ' + row.floor + ' · ' + tLbl + coordHint;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        orientaRelocatePoiSelectRow_(row, btn);
      });
      relocatePoiList.appendChild(btn);
    })(rows[i]);
  }
}
function orientaFormatVideoTimeLabel_(sec) {
  var s = Math.max(0, Math.floor(Number(sec)));
  if (!Number.isFinite(s)) return '0:00';
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function orientaAttachGlobalClipToRelocateRows_(rows) {
  if (!rows || !__pekRows) return rows;
  orientaEnsurePekRowsGlobalClipTimeFull_();
  for (var i = 0; i < rows.length; i++) {
    var idx = orientaFindPekRowIndexForRelocate_(rows[i]);
    if (idx >= 0 && __pekRows[idx].globalClipT != null && Number.isFinite(__pekRows[idx].globalClipT)) {
      rows[i].globalClipT = Number(__pekRows[idx].globalClipT);
      rows[i].mergedTimeLabel = orientaFormatVideoTimeLabel_(rows[i].globalClipT);
    }
  }
  return rows;
}
function orientaFilterRelocateRowsForPicker_(all) {
  var rows = all.slice();
  var bounds = orientaGetPekRelocatePickerClipBounds_();
  if (bounds) {
    var byClip = rows.filter(function (row) {
      var idx = orientaFindPekRowIndexForRelocate_(row);
      return idx >= bounds.fromIdx && idx <= bounds.toIdx;
    });
    if (byClip.length) return byClip;
  }
  var stem = orientaCurrentPekVideoStem_();
  var merged = stem && orientaPekIsFullTimelineBasename_(stem + '.mp4');
  if (!merged && stem) {
    rows = rows.filter(function (row) {
      return String(row.videoStem || '').toUpperCase() === String(stem).toUpperCase();
    });
  }
  if (!rows.length) rows = all.slice();
  return rows;
}
function orientaShowRelocatePoiPicker_() {
  if (!relocatePoiOverlay || !relocatePoiList) return;
  __orientaRelocatePoiSelectedRow_ = null;
  __orientaRelocatePoiListRows_ = [];
  orientaRelocatePoiUpdateSelectionUi_();
  relocatePoiList.innerHTML = '<div class="relocate-poi-hint" style="padding:12px">加载 POI 列表…</div>';
  if (relocatePoiHint) relocatePoiHint.textContent = '从 ' + ORIENTA_PEK_RELOC_CSV + ' 选择，再点确定';
  relocatePoiOverlay.classList.add('visible');
  relocatePoiOverlay.setAttribute('aria-hidden', 'false');
  function finishPicker_(all) {
    all = orientaAttachGlobalClipToRelocateRows_(all);
    var rows = orientaFilterRelocateRowsForPicker_(all);
    __orientaRelocatePoiListRows_ = rows;
    var dest = orientaGetPekRouteToGate_();
    if (relocatePoiHint) {
      var bnd = orientaGetPekRelocatePickerClipBounds_();
      relocatePoiHint.textContent =
        rows.length +
        ' 个 POI' +
        (bnd && bnd.fromGate && bnd.toGate ? ' · 路线 ' + bnd.fromGate + '→' + bnd.toGate : '') +
        (dest ? ' · 目的地 ' + dest : '') +
        ' · 可选 L2/L3 · 点选后确定';
    }
    orientaRenderRelocatePoiList_(rows);
  }
  if (__pekRows && __pekRows.length) {
    var fromRows = __pekRows.map(function (r) {
      return {
        poi: 'Gate_' + r.gate,
        gate: r.gate,
        floor: r.floor,
        video: r.video,
        videoStem: String(r.video || '').replace(/\.(mp4|MP4)$/i, ''),
        segmentTime: r.segmentTime,
        timeLabel: orientaFormatVideoTimeLabel_(r.segmentTime),
        globalClipT: r.globalClipT,
        mergedTimeLabel: r.globalClipT != null ? orientaFormatVideoTimeLabel_(r.globalClipT) : '',
      };
    });
    try {
      finishPicker_(fromRows);
      return;
    } catch (eLocal) {}
  }
  fetch(ORIENTA_PEK_RELOC_CSV, { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (text) {
      var all = orientaParsePekRelocateCsvText_(text);
      if (!all.length) throw new Error('empty');
      finishPicker_(all);
    })
    .catch(function () {
      relocatePoiList.innerHTML =
        '<div class="relocate-poi-hint" style="padding:12px">无法加载 ' +
        ORIENTA_PEK_RELOC_CSV +
        '</div>';
    });
}
function orientaRelocatePoiConfirm_() {
  var row = __orientaRelocatePoiSelectedRow_;
  if (!row) return;
  if (!orientaRelocatePoiRowHasCoords_(row)) {
    orientaHideRelocatePoiPicker_();
    orientaSeekVideoToRelocateRow_(row);
    var elNc = document.getElementById('pdrImuStatus');
    if (elNc) elNc.textContent = '已跳转 ' + row.timeLabel + ' · 无地图坐标';
    return;
  }
  orientaApplyRelocateAtPoiRow_(row);
}
function orientaApplyRelocateAtPoiRow_(row) {
  if (!row) return;
  var videoMode = orientaApplyPekRelocateSlice_(row);
  var ll = orientaLookupPekPoiLngLat_(row.gate, row.poi, row.floor);
  if (!ll || ll.length < 2) {
    var el = document.getElementById('pdrImuStatus');
    if (el) el.textContent = '无坐标：' + (row.poi || row.gate || '');
    return;
  }
  orientaHideRelocatePoiPicker_();
  if (videoMode !== 'segment' && videoMode !== 'dynamic') orientaSeekVideoToRelocateRow_(row);
  var headingRad = orientaResolveRelocateHeadingRad_(ll);
  var headingDeg = orientaHeadingDegFromRad_(headingRad);
  var pdrOn = !!(window.__ORIENTA_PDR__ && window.__ORIENTA_PDR__.active);
  window.__ORIENTA_LAST_RELOC__ = {
    lngLat: ll,
    headingRad: headingRad,
    gate: row.gate,
    poi: row.poi,
    floor: row.floor,
    at: Date.now(),
  };
  window.__ORIENTA_MANUAL_RELOC_OVERRIDE__ = null;
  if (row.floor) {
    try {
      var mapFl = String(row.floor).replace(/^F/i, 'L');
      orientaMaybePostIndoorFloor_(mapFl);
      __orientaLastPostedMapFloor = mapFl;
      if (__orientaPekClipFloorMode_ === 'L2_ONLY') __orientaPekHystWantL3 = false;
      if (__orientaPekClipFloorMode_ === 'L3_ONLY') __orientaPekHystWantL3 = true;
    } catch (eFl) {}
  }
  orientaSyncPdrNextPoiIdxForGate_(row.gate);
  if (pdrOn && typeof window.__ORIENTA_PDR__.snapReset === 'function') {
    window.__ORIENTA_PDR__.snapReset(ll[0], ll[1], headingDeg);
    __orientaPdrLastPoiSnapMs_ = Date.now();
    orientaRefreshPdrVideoSyncAnchor_(0);
  } else {
    orientaRefreshPdrVideoSyncAnchor_(0);
  }
  var elOk = document.getElementById('pdrImuStatus');
  if (elOk) elOk.textContent = '已重定位 · ' + (row.poi || row.gate);
  window.setTimeout(function () {
    try {
      if (pdrOn) {
        var st = window.__ORIENTA_PDR__.getState && window.__ORIENTA_PDR__.getState();
        var pose = st && st.lastPose;
        if (pose && isFinite(pose.distanceM) && isFinite(pose.steps)) {
          var elPose = document.getElementById('pdrImuStatus');
          if (elPose) elPose.textContent = pose.distanceM.toFixed(1) + 'm · ' + pose.steps + '步';
        }
      }
    } catch (eRestore) {}
  }, 1200);
  if (videoMode !== 'segment') {
    try {
      orientaLastTouristPushMs_ = 0;
      pushTouristPositionToBackend();
    } catch (ePush) {}
    try {
      var pos = getCurrentTouristPosition();
      if (pos) orientaForwardTouristPosToIndoorMap_(pos, null);
    } catch (eFwd) {}
  }
}
function orientaPdrManualRelocate_() {
  orientaShowRelocatePoiPicker_();
}
function orientaExtractWaypointsLngLat_() {
  var out = [];
  try {
    var wps = window.__ORIENTA_NAV_PATH_WAYPOINTS_ONLY__;
    if (!Array.isArray(wps) || !wps.length) return out;
    for (var i = 0; i < wps.length; i++) {
      var w = wps[i];
      if (!w || typeof w !== 'object') continue;
      var lng = null, lat = null;
      if (Array.isArray(w.coord) && w.coord.length >= 2) { lng = Number(w.coord[0]); lat = Number(w.coord[1]); }
      else if (Array.isArray(w.lngLat) && w.lngLat.length >= 2) { lng = Number(w.lngLat[0]); lat = Number(w.lngLat[1]); }
      else if (Array.isArray(w.lonlat) && w.lonlat.length >= 2) { lng = Number(w.lonlat[0]); lat = Number(w.lonlat[1]); }
      else if (w.position && typeof w.position === 'object') { lng = Number(w.position.lng); lat = Number(w.position.lat); }
      else { lng = Number(w.lng != null ? w.lng : w.lon); lat = Number(w.lat != null ? w.lat : w.latitude); }
      if (!isFinite(lng) || !isFinite(lat)) continue;
      out.push([lng, lat]);
    }
  } catch (e) {}
  return out;
}

function drawPeoplePage(){
  orientaUpdatePdrRelocateBtn_();
  orientaClampPekVideoTime_();
  updateTimeLabel();
  if (!scrubbing && isFinite(vid.duration) && vid.duration > 0){
    if (typeof __pekClip !== 'undefined' && __pekClip) {
      const b = orientaPekClipPlayBoundsForVid_(vid);
      const t0 = b ? b.t0 : __pekClip.t0;
      const tEnd = b ? b.tEnd : __pekClip.t1;
      const span = Math.max(1e-6, tEnd - t0);
      timeSlider.value = Math.round(((vid.currentTime - t0) / span) * 1000);
    } else {
      timeSlider.value = Math.round((vid.currentTime / vid.duration) * 1000);
    }
  }

  // time -> full-path distance; clamp to STOP_AT if known
  const dur   = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 0;
  const gateT = (STOP_AT == null) ? dur : STOP_AT;         // safe before init

  // === PDR: drive video progress from live walking ===
  const pdrVideoSyncOn =
    window.__ORIENTA_PDR__ &&
    window.__ORIENTA_PDR__.active &&
    orientaReadBoolParam_('pdrVideoSync', true) &&
    !scrubbing &&
    !(gateCheckpointOverlay && gateCheckpointOverlay.classList.contains('visible')) &&
    !(gateWhichGateOverlay && gateWhichGateOverlay.classList.contains('visible'));
  if (pdrVideoSyncOn) {
    try {
      var pdrStateForVideo =
        window.__ORIENTA_PDR__.getState && window.__ORIENTA_PDR__.getState();
      var poseForVideo = pdrStateForVideo && pdrStateForVideo.lastPose;
      var pdrDistM = poseForVideo ? Number(poseForVideo.distanceM) : NaN;
      if (isFinite(pdrDistM) && pdrDistM >= 0) {
        var t0v = 0;
        var tEndV = gateT;
        if (typeof __pekClip !== 'undefined' && __pekClip) {
          var bb = orientaPekClipPlayBoundsForVid_(vid);
          t0v = bb ? bb.t0 : __pekClip.t0;
          tEndV = bb ? bb.tEnd : __pekClip.t1;
          if (gateT != null && isFinite(gateT)) tEndV = Math.min(tEndV, gateT);
        }
        var spanV = Math.max(1e-6, tEndV - t0v);
        var routeMeters = orientaGetPdrVideoRouteMeters_();
        var clipKey = orientaPdrVideoSyncClipKey_();
        var anchor = __orientaPdrVideoSyncAnchor_;
        if (!anchor || anchor.clipKey !== clipKey) orientaRefreshPdrVideoSyncAnchor_(pdrDistM);
        anchor = __orientaPdrVideoSyncAnchor_;
        var anchorVideo = anchor && Number.isFinite(anchor.videoLocalSec) ? anchor.videoLocalSec : t0v;
        var anchorPdr = anchor && Number.isFinite(anchor.pdrDistM) ? anchor.pdrDistM : 0;
        var deltaM = Math.max(0, pdrDistM - anchorPdr);
        var secPerMeter = spanV / routeMeters;
        var tTargetLocal = anchorVideo + deltaM * secPerMeter;
        tTargetLocal = Math.max(0, Math.min(spanV, tTargetLocal));
        var tTarget = t0v + tTargetLocal;
        var err = tTarget - vid.currentTime;
        if (err < -0.15 && !vid.seeking) {
          orientaRefreshPdrVideoSyncAnchor_(pdrDistM);
          err = 0;
        }
        if (err > 0.05 && !vid.seeking) {
          var maxSeekStep = err > 1.2 ? 0.55 : 0.22;
          var step = Math.min(maxSeekStep, err * 0.55);
          if (step > 0) vid.currentTime = vid.currentTime + step;
        }
        if (err <= 0.12) {
          vid.playbackRate = 1.0;
          if (!vid.paused) vid.pause();
        } else if (err > 0.12) {
          try {
            if (vid.paused) vid.play();
          } catch (ePlay) {}
          var k = 0.22;
          var rate = 1.0 + k * err;
          if (!isFinite(rate)) rate = 1.0;
          vid.playbackRate = Math.max(0.35, Math.min(1.65, rate));
        } else {
          vid.playbackRate = 1.0;
        }
      }
    } catch (ePdrSync) {}
  }

  // Use video currentTime, but ensure arrow reaches the end smoothly even if video pauses
  let cur = dur ? vid.currentTime : 0;
  // If video is paused near the end, ensure arrow completes the path
  if (vid.paused && cur >= gateT - 0.05) {
    cur = gateT; // Arrow should be at the end when video stops
  } else {
    cur = dur ? Math.min(cur, gateT) : 0;
  }
  if (GATE_CHECKPOINTS && GATE_CHECKPOINTS.length && gateCheckpointOverlay && gateWhichGateOverlay &&
      !gateCheckpointOverlay.classList.contains('visible') && !gateWhichGateOverlay.classList.contains('visible')) {
    checkGateCheckpoint(cur);
  }
  const baseRaw = orientaVideoProgress01FromCur_(cur);
  var pathLLDraw = orientaGetPathLonLat_();

  // === PDR: POI snap + reset when within 2m of next route POI (default on) ===
  if (window.__ORIENTA_PDR__ && window.__ORIENTA_PDR__.active && orientaReadBoolParam_('pdrPoiSnap', true)) {
    try {
      var nowMs = Date.now();
      if (nowMs - __orientaPdrLastPoiSnapMs_ > 800) {
        var routePois = orientaGetRoutePoisForMapCheckpoint_();
        if (routePois && routePois.length >= 1) {
          if (__orientaPdrNextPoiIdx_ < 0) __orientaPdrNextPoiIdx_ = 0;
          if (__orientaPdrNextPoiIdx_ >= routePois.length) __orientaPdrNextPoiIdx_ = routePois.length - 1;
          var nextPoiSnap = routePois[__orientaPdrNextPoiIdx_];
          var nextPoi = nextPoiSnap && nextPoiSnap.lngLat;
          var pdrPos = orientaGetPdrLngLat_();
          if (pdrPos && nextPoi && nextPoi.length >= 2) {
            var dM = orientaDistLngLatM_(pdrPos, nextPoi);
            if (dM != null && isFinite(dM) && dM <= 2.0) {
              var headingSeed = null;
              if (__orientaPdrNextPoiIdx_ + 1 < routePois.length) {
                var nxt = routePois[__orientaPdrNextPoiIdx_ + 1];
                if (nxt && nxt.lngLat) headingSeed = orientaBearingDeg_(nextPoi, nxt.lngLat);
              }
              if (typeof window.__ORIENTA_PDR__.snapReset === 'function') {
                window.__ORIENTA_PDR__.snapReset(nextPoi[0], nextPoi[1], headingSeed);
              }
              orientaRefreshPdrVideoSyncAnchor_(0);
              __orientaPdrLastPoiSnapMs_ = nowMs;
            }
          }
        }
      }
    } catch (ePoi) {}
  }

  var useIndoorGeoProgress = !!(window.__ORIENTA_PATH_LONLAT_FROM_MAP__ && pathLLDraw && pathLLDraw.length >= 2);
  if (useIndoorGeoProgress !== __orientaSmoothedMapPathWasActive_) {
    __orientaMapDisplayBaseSmoothed_ = null;
    __orientaMapDisplayBaseLastRaw_ = null;
    __orientaSmoothedMapPathWasActive_ = useIndoorGeoProgress;
  }
  var gateSyncSec = orientaVideoLocalSecForGateSync_(cur);
  var gateDrivenBase = orientaMapSyncVideoOnly_() ? null : orientaMapBaseFromGateSegments_(baseRaw, pathLLDraw, gateSyncSec);
  const base =
    gateDrivenBase != null
      ? orientaCapPathSyncToVideoProgress_(gateDrivenBase, baseRaw)
      : useIndoorGeoProgress
        ? orientaSmoothedMapDisplayBase_(baseRaw, scrubbing)
        : baseRaw;
  __orientaOlHideFullRoute = false;
  /** Same split as getCurrentTouristPosition — one source of truth so the dot stays on the drawn polyline. */
  var _mapResolve = orientaResolveMapSplitMsFromVideo_(baseRaw, { postFloor: false, videoTimeSec: gateSyncSec });
  var mapSplit = _mapResolve.ms;
  var pathUsedForMap = _mapResolve.pathUsed;
  var _stab = orientaApplyDisplayMapSplitStability_(mapSplit, pathUsedForMap);
  mapSplit = _stab.ms;
  pathUsedForMap = _stab.pathUsed;
  if (
    orientaPdrOverridesVideoRouteDot_() &&
    window.__ORIENTA_PDR__ &&
    window.__ORIENTA_PDR__.active &&
    typeof window.__ORIENTA_PDR__.buildMapSplit === "function"
  ) {
    try {
      var _pdrSplit = window.__ORIENTA_PDR__.buildMapSplit();
      if (_pdrSplit && orientaCoordFiniteLngLat_(_pdrSplit.coord)) {
        mapSplit = _pdrSplit;
        pathUsedForMap = null;
      }
    } catch (_pdrE) {}
  }

  try {
    window.__ORIENTA_DISPLAY_MAP_SPLIT_RESOLVE__ = { ms: mapSplit, pathUsed: pathUsedForMap };
  } catch (eMapCache) {}

  if (
    mapSplit &&
    orientaCoordFiniteLngLat_(mapSplit.coord) &&
    !(gateCheckpointOverlay && gateCheckpointOverlay.classList.contains('visible')) &&
    !(gateWhichGateOverlay && gateWhichGateOverlay.classList.contains('visible'))
  ) {
    orientaCheckMapPoiProximityCheckpoint_(mapSplit.coord);
  }

  orientaPublishTouristMapDebug_(base, mapSplit, pathUsedForMap, scrubbing);

  if (!window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__ && useTencentMap && mapPeopleTencent && tencentPolylineLayer && tencentMarkerLayer && mapSplit) {
    const coord = mapSplit.coord;
    const pastCoords = mapSplit.pastCoords;
    const futureCoords = mapSplit.futureCoords;
    const geoms = [];
    if (pastCoords.length >= 2) {
      geoms.push({ id: 'past', styleId: 'past', paths: [orientaLonLatPathToTMapLatLngs_(pastCoords)] });
    }
    if (futureCoords.length >= 2) {
      geoms.push({ id: 'fut', styleId: 'future', paths: [orientaLonLatPathToTMapLatLngs_(futureCoords)] });
    }
    tencentPolylineLayer.setGeometries(geoms);
    tencentMarkerLayer.setGeometries([{
      id: 'nav',
      styleId: 'nav',
      position: new TMap.LatLng(coord[1], coord[0]),
    }]);
  } else if (!window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__ && peoplePointFeature && peoplePathSource && mapSplit) {
    __orientaOlHideFullRoute = true;
    const coord = mapSplit.coord;
    const pastCoords = mapSplit.pastCoords;
    const futureCoords = mapSplit.futureCoords;
    peoplePointFeature.getGeometry().setCoordinates(ol.proj.fromLonLat(coord));
    function orientaUpsertOlPathLine_(type, lonLatPath) {
      var ref = type === "past" ? __orientaOlPastFeature : __orientaOlFutureFeature;
      if (!lonLatPath || lonLatPath.length < 2) {
        if (ref) {
          try {
            peoplePathSource.removeFeature(ref);
          } catch (eR0) {}
          if (type === "past") __orientaOlPastFeature = null;
          else __orientaOlFutureFeature = null;
        }
        return;
      }
      var projC = lonLatPath.map(function (c) {
        return ol.proj.fromLonLat(c);
      });
      var geom = new ol.geom.LineString(projC);
      var refLive =
        ref &&
        (typeof peoplePathSource.hasFeature === "function"
          ? peoplePathSource.hasFeature(ref)
          : peoplePathSource.getFeatures().indexOf(ref) >= 0);
      if (refLive) {
        ref.setGeometry(geom);
      } else {
        if (ref) {
          try {
            peoplePathSource.removeFeature(ref);
          } catch (eR1) {}
        }
        ref = new ol.Feature({ geometry: geom });
        ref.set("type", type);
        peoplePathSource.addFeature(ref);
        if (type === "past") __orientaOlPastFeature = ref;
        else __orientaOlFutureFeature = ref;
      }
    }
    orientaUpsertOlPathLine_("past", pastCoords);
    orientaUpsertOlPathLine_("future", futureCoords);
    var pathForHeading =
      pathUsedForMap && mapSplit && pathUsedForMap.length === mapSplit.n ? pathUsedForMap : null;
    var cNext =
      (mapSplit.tt < 1 - 1e-6)
        ? mapSplit.b
        : pathForHeading
          ? pathForHeading[Math.min(mapSplit.si + 2, mapSplit.n - 1)] || mapSplit.b
          : mapSplit.b;
    var dx = cNext[0] - coord[0];
    var dy = cNext[1] - coord[1];
    var headingSplit = orientaHeadingRadAlongSplitMs_(mapSplit, pathUsedForMap);
    var heading =
      mapSplit._pdrHeadingRad != null && isFinite(mapSplit._pdrHeadingRad)
        ? mapSplit._pdrHeadingRad
        : headingSplit != null && isFinite(headingSplit)
          ? headingSplit
          : Math.atan2(-dy, dx);
    peoplePointFeature.set('arrowRotation', heading);
    peoplePointFeature.changed();
  }

  const pathSpan = Math.max(0, 1 - DOT_START_OFFSET - DOT_END_OFFSET);
  const pathRatio = DOT_START_OFFSET + pathSpan * base;
  if (AMENITIES.length) {
    const approaching = AMENITIES.filter(function(a){
      const frac = typeof a.path_fraction !== 'undefined' ? a.path_fraction : a.fraction;
      if (frac == null || typeof frac !== 'number') return false;
      return pathRatio >= frac - AMENITIES_LOOKAHEAD && pathRatio < frac + AMENITIES_PASSED_WINDOW;
    }).sort(function(a,b){
      const fa = typeof a.path_fraction !== 'undefined' ? a.path_fraction : a.fraction;
      const fb = typeof b.path_fraction !== 'undefined' ? b.path_fraction : b.fraction;
      return (fa || 0) - (fb || 0);
    }).slice(0, AMENITIES_MAX_SHOW);
    var chipHtml = approaching.map(function(a){
      var name = (a.name || a.label || '').replace(/</g,'&lt;');
      var cls = 'amenity-chip' + (a.type === 'shop' ? ' shop' : '');
      return '<span class="'+cls+'">'+name+'</span>';
    }).join('');
    if (amenitiesPanel) amenitiesPanel.innerHTML = approaching.map(function(a){
      var name = (a.name || a.label || '').replace(/</g,'&lt;');
      var cls = 'amenity-item' + (a.type === 'shop' ? ' shop' : '');
      return '<div class="'+cls+'">'+name+'</div>';
    }).join('');
    if (amenitiesVideoList) amenitiesVideoList.innerHTML = chipHtml;
  }

  info.textContent = `Video: ${dur.toFixed(1)}s (${FROM_LABEL} → ${TARGET_LABEL})`;
}


function loop(){
  requestAnimationFrame(loop);
  drawPeoplePage();
}
/** PDR anchor: explicit URL，否则地图 POI（与路线/重定位同一套 gate 坐标） */
window.orientaPdrResolveAnchor = function () {
  try {
    var sp = new URLSearchParams(location.search);
    var lat = parseFloat(sp.get('pdrOriginLat') || sp.get('pdrLat') || '');
    var lng = parseFloat(sp.get('pdrOriginLng') || sp.get('pdrLng') || '');
    if (isFinite(lat) && isFinite(lng)) return [lng, lat];
    if (window.__ROUTESITE_HUB__ !== 'PEK') return null;
    var g = orientaNormalizeGate_(sp.get('gateFrom') || sp.get('from') || sp.get('origin') || '');
    if (!g) return null;
    var ll = orientaLookupPekEGateLngLat_(g);
    if (ll) return ll.slice();
  } catch (e) {}
  return null;
};
requestAnimationFrame(loop);
