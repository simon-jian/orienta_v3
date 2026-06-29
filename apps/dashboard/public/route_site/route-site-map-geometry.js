/**
 * route_site engine #2 — path / floor / map geometry (Multi-airport Phase 4).
 *
 * Route polyline + per-floor slicing, planar map-split / projection helpers,
 * tourist-position debug ring, gate-segment time-stretch tuning, and the
 * amenities/segment data constants. Depends on globals from
 * route-site-pek-engine.js (e.g. PATH_LONLAT_PEK); loads before
 * route-site-main.js. Split verbatim from the former route-site-app.js.
 */
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

