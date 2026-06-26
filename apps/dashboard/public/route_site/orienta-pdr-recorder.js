/**
 * PDR + navigation position recorder for offline analysis.
 * Hooks via window.orientaPdrRecorderHook (sensor / pose / tourist_map).
 */
(function () {
  var MAX_SENSOR = 24000;
  var MAX_POSE = 10000;
  var MAX_TOURIST = 12000;
  var MAX_STATE_SNAP = 1200;
  var STATE_SNAP_MS = 2000;

  var rec = {
    active: false,
    startedAtMs: 0,
    meta: null,
    sensorFrames: [],
    poseUpdates: [],
    socketMessages: [],
    touristMap: [],
    stateSnapshots: [],
    _snapTimer: null,
  };

  function ringPush(arr, item, max) {
    arr.push(item);
    if (arr.length > max) arr.shift();
  }

  function collectMeta() {
    var sp = {};
    try {
      sp = Object.fromEntries(new URLSearchParams(location.search).entries());
    } catch (e) {}
    var pdr = null;
    try {
      if (window.__ORIENTA_PDR__ && typeof window.__ORIENTA_PDR__.getState === "function") {
        pdr = window.__ORIENTA_PDR__.getState();
      }
    } catch (e2) {}
    return {
      recordedAt: new Date().toISOString(),
      pageUrl: String(location.href || ""),
      query: sp,
      tenantId: typeof ROUTE_SITE_TENANT_ID !== "undefined" ? ROUTE_SITE_TENANT_ID : "",
      passengerId: typeof ROUTE_SITE_PASSENGER_ID !== "undefined" ? ROUTE_SITE_PASSENGER_ID : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      pdr: pdr
        ? {
            active: !!pdr.active,
            sessionId: pdr.sessionId || null,
            anchorLngLat: pdr.anchorLngLat ? pdr.anchorLngLat.slice() : null,
            mapMatch: !!pdr.mapMatch,
            motionEvents: pdr.motionEvents || 0,
            trailVerts: pdr.trail ? pdr.trail.length : 0,
            lastPose: pdr.lastPose || null,
          }
        : null,
      lastTouristMap: null,
    };
  }

  function snapshotPdrState() {
    if (!rec.active) return;
    var row = { wallMs: Date.now(), perfMs: typeof performance !== "undefined" ? performance.now() : 0 };
    try {
      if (window.__ORIENTA_PDR__ && typeof window.__ORIENTA_PDR__.getState === "function") {
        var st = window.__ORIENTA_PDR__.getState();
        row.pdr = {
          active: !!st.active,
          sessionId: st.sessionId || null,
          motionEvents: st.motionEvents || 0,
          markerLngLat: st.markerLngLat ? st.markerLngLat.slice() : null,
          trail: st.trail ? st.trail.slice(-80) : [],
          lastPose: st.lastPose || null,
          headingRad: st.headingRad,
        };
      }
    } catch (e) {}
    try {
      if (typeof window.orientaDumpTouristPosition === "function") {
        row.tourist = window.orientaDumpTouristPosition();
      }
    } catch (e2) {}
    try {
      var vt = typeof vid !== "undefined" && vid ? vid.currentTime : null;
      if (vt != null) row.videoTime = vt;
    } catch (e3) {}
    ringPush(rec.stateSnapshots, row, MAX_STATE_SNAP);
  }

  function startSnapTimer() {
    stopSnapTimer();
    rec._snapTimer = setInterval(snapshotPdrState, STATE_SNAP_MS);
  }

  function stopSnapTimer() {
    if (rec._snapTimer) {
      clearInterval(rec._snapTimer);
      rec._snapTimer = null;
    }
  }

  window.orientaPdrRecorderHook = function (kind, payload) {
    if (!rec.active || !payload) return;
    var wallMs = Date.now();
    if (kind === "sensor_frame") {
      ringPush(rec.sensorFrames, { wallMs: wallMs, outbound: payload }, MAX_SENSOR);
      return;
    }
    if (kind === "pose_update") {
      ringPush(rec.poseUpdates, { wallMs: wallMs, inbound: payload }, MAX_POSE);
      return;
    }
    if (kind === "socket_message") {
      ringPush(rec.socketMessages, { wallMs: wallMs, inbound: payload }, MAX_POSE);
      return;
    }
    if (kind === "tourist_map") {
      ringPush(rec.touristMap, Object.assign({ wallMs: wallMs }, payload), MAX_TOURIST);
    }
  };

  function buildExportPayload() {
    var ended = Date.now();
    return {
      format: "orienta-pdr-recording-v1",
      meta: rec.meta,
      durationMs: rec.startedAtMs ? ended - rec.startedAtMs : 0,
      counts: {
        sensorFrames: rec.sensorFrames.length,
        poseUpdates: rec.poseUpdates.length,
        socketMessages: rec.socketMessages.length,
        touristMap: rec.touristMap.length,
        stateSnapshots: rec.stateSnapshots.length,
      },
      sensorFrames: rec.sensorFrames,
      poseUpdates: rec.poseUpdates,
      socketMessages: rec.socketMessages,
      touristMap: rec.touristMap,
      stateSnapshots: rec.stateSnapshots,
      touristMapHistoryTail:
        typeof window.orientaGetTouristPositionHistory === "function"
          ? window.orientaGetTouristPositionHistory().slice(-500)
          : [],
    };
  }

  function downloadJson(obj) {
    var pid =
      (rec.meta && rec.meta.passengerId) ||
      (typeof ROUTE_SITE_PASSENGER_ID !== "undefined" ? ROUTE_SITE_PASSENGER_ID : "") ||
      "pax";
    var ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    var name = "orienta-pdr-" + String(pid).replace(/[^\w.-]+/g, "_") + "-" + ts + ".json";
    var blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try {
        URL.revokeObjectURL(a.href);
        a.remove();
      } catch (e) {}
    }, 400);
    return name;
  }

  window.orientaIsPdrDataRecording = function () {
    return !!rec.active;
  };

  window.orientaStartPdrDataRecording = function () {
    if (rec.active) return { ok: false, error: "already_recording" };
    rec.active = true;
    rec.startedAtMs = Date.now();
    rec.sensorFrames = [];
    rec.poseUpdates = [];
    rec.socketMessages = [];
    rec.touristMap = [];
    rec.stateSnapshots = [];
    rec.meta = collectMeta();
    snapshotPdrState();
    startSnapTimer();
    return { ok: true, startedAt: rec.meta.recordedAt };
  };

  window.orientaStopPdrDataRecording = function (opts) {
    opts = opts || {};
    if (!rec.active) return { ok: false, error: "not_recording" };
    rec.active = false;
    stopSnapTimer();
    snapshotPdrState();
    var payload = buildExportPayload();
    var file = null;
    if (opts.download !== false) file = downloadJson(payload);
    return { ok: true, file: file, counts: payload.counts };
  };

  window.orientaExportPdrDataRecording = function () {
    if (rec.active) snapshotPdrState();
    var payload = buildExportPayload();
    var file = downloadJson(payload);
    return { ok: true, file: file, counts: payload.counts };
  };

  function refreshRecordButtonUi() {
    var btn = document.getElementById("btnPdrRecord");
    if (!btn) return;
    if (rec.active) {
      btn.classList.add("orienta-pdr-recording");
      btn.textContent = "导出";
      btn.title = "结束录制并下载 JSON（含 PDR 原始 IMU 与导航位置）";
    } else {
      btn.classList.remove("orienta-pdr-recording");
      btn.textContent = "记录";
      btn.title = "开始记录 PDR 原始数据与导航位置（用于精度分析）";
    }
  }

  function toggleRecord() {
    if (rec.active) {
      var r = window.orientaStopPdrDataRecording({ download: true });
      refreshRecordButtonUi();
      var el = document.getElementById("pdrRecordStatus");
      if (el) {
        if (r.ok) {
          el.textContent =
            "已导出 " +
            (r.file || "json") +
            " · IMU " +
            (r.counts.sensorFrames || 0) +
            " · 位置 " +
            (r.counts.touristMap || 0);
        } else el.textContent = "导出失败";
      }
      return;
    }
    var s = window.orientaStartPdrDataRecording();
    refreshRecordButtonUi();
    var st = document.getElementById("pdrRecordStatus");
    if (st) st.textContent = s.ok ? "录制中…" : "无法开始";
  }

  function bindUi() {
    var btn = document.getElementById("btnPdrRecord");
    if (btn) btn.addEventListener("click", toggleRecord);
    refreshRecordButtonUi();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi);
  else bindUi();
})();
