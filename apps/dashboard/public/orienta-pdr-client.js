/**
 * Video page: phone IMU → PDR Python backend → map trajectory.
 * Anchor WGS84: optional ?pdrOriginLat/Lng. If omitted on PEK, origin = gateFrom via orientaPdrResolveAnchor (地图 POI API).
 * Parent /pax forwards pdrOrigin* into the iframe. Same-origin: /pdr-api. ?pdrBackend= override.
 * Optional: ?pdrMapMatch=1 — corridor map-matching on backend.
 */
(function () {
  var R_EARTH = 6378137;

  /** WGS84 [lng, lat]: explicit hook, query, then window.orientaPdrResolveAnchor. */
  function resolvePdrAnchor() {
    try {
      var hook = window.__ORIENTA_PDR_ANCHOR__;
      if (hook && isFinite(hook[0]) && isFinite(hook[1])) return [Number(hook[0]), Number(hook[1])];
    } catch (eHook) {}
    try {
      var sp = new URLSearchParams(location.search);
      var lat = parseFloat(sp.get("pdrOriginLat") || sp.get("pdrLat") || "");
      var lng = parseFloat(sp.get("pdrOriginLng") || sp.get("pdrLng") || "");
      if (isFinite(lat) && isFinite(lng)) return [lng, lat];
    } catch (e) {}
    if (typeof window.orientaPdrResolveAnchor === "function") {
      try {
        var o = window.orientaPdrResolveAnchor();
        if (o && isFinite(o[0]) && isFinite(o[1])) return o;
      } catch (e2) {}
    }
    return null;
  }

  /** Absolute PDR base must be service root (https://host), not …/api — session URL is root + "/api/session". */
  function normalizePdrBackendParam(b) {
    var s = String(b || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(s) && /\/api$/i.test(s)) s = s.replace(/\/api$/i, "").replace(/\/+$/, "");
    return s;
  }

  function apiRoot() {
    try {
      var b = new URLSearchParams(location.search).get("pdrBackend");
      if (b && String(b).trim()) return normalizePdrBackendParam(b);
    } catch (e) {}
    if (typeof window.orientaUrl === "function") return window.orientaUrl("/pdr-api");
    return "/pdr-api";
  }

  function wsBaseUrl() {
    var root = apiRoot();
    if (root.indexOf("http://") === 0) return "ws://" + root.slice("http://".length);
    if (root.indexOf("https://") === 0) return "wss://" + root.slice("https://".length);
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + root;
  }

  function metersToLngLat(anchor, x, y) {
    var lng0 = anchor[0];
    var lat0 = anchor[1];
    var lat1 = (lat0 * Math.PI) / 180;
    var dLat = (y / R_EARTH) * (180 / Math.PI);
    var dLng = (x / (R_EARTH * Math.cos(lat1))) * (180 / Math.PI);
    return [lng0 + dLng, lat0 + dLat];
  }

  /** Cap outbound sensor-frame rate — devicemotion can fire far faster than the
   *  PDR step-detection algorithm needs (min step period is 250ms server-side),
   *  so sending every event wastes battery/bandwidth for no accuracy gain. */
  var MIN_FRAME_INTERVAL_MS = 50; // 20 Hz
  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 15000;

  var st = {
    active: false,
    stopping: false,
    status: "",
    sessionId: null,
    socket: null,
    lastTrailMs: 0,
    lastOrientation: {},
    anchorLngLat: null,
    markerLngLat: null,
    trail: [],
    headingRad: null,
    mapMatch: false,
    motionHandler: null,
    orientHandler: null,
    motionEvents: 0,
    motionWarnTimer: null,
    lastStatusMs: 0,
    lastPose: null,
    lastFrameSentMs: 0,
    // True while the page is hidden (screen locked / app backgrounded): sensor
    // listeners are removed but the session/socket stay alive so a brief
    // backgrounding resumes instantly instead of restarting from zero.
    pausedForVisibility: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
  };

  function clearMotionWarnTimer() {
    if (st.motionWarnTimer != null) {
      clearTimeout(st.motionWarnTimer);
      st.motionWarnTimer = null;
    }
  }

  /** off | connected (WS OK) | imu (devicemotion firing) */
  function setPdrButtonState(phase) {
    var btn = document.getElementById("btnPdrImu");
    if (!btn) return;
    btn.classList.remove("orienta-pdr-connected", "orienta-pdr-imu-live");
    if (phase === "connected" || phase === "imu") btn.classList.add("orienta-pdr-connected");
    if (phase === "imu") btn.classList.add("orienta-pdr-imu-live");
  }

  function setStatus(msg) {
    st.status = msg || "";
    var el = document.getElementById("pdrImuStatus");
    if (el) el.textContent = st.status;
    try {
      if (typeof window.__ORIENTA_PDR_ON_STATUS__ === "function") {
        window.__ORIENTA_PDR_ON_STATUS__(st.status);
      }
    } catch (eStat) {}
  }

  function buildPathPayload(lng, lat) {
    return st.trail.length >= 2
      ? st.trail.map(function (c) {
          return { lat: c[1], lng: c[0] };
        })
      : [{ lat: lat, lng: lng }];
  }

  function postTrajectoryToParent(lng, lat) {
    var pathPayload = buildPathPayload(lng, lat);
    try {
      if (typeof window.__ORIENTA_PDR_ON_TRAJECTORY__ === "function") {
        window.__ORIENTA_PDR_ON_TRAJECTORY__(lng, lat, pathPayload, st.headingRad);
      }
    } catch (eHook) {}
    if (!window.parent || window.parent === window) return;
    var pid = "";
    try {
      pid = window.__ORIENTA_PDR_PASSENGER_ID__ || window.ROUTE_SITE_PASSENGER_ID || "";
    } catch (e) {}
    if (!pid) return;
    try {
      window.parent.postMessage(
        {
          type: "orienta-pax-trajectory",
          position: { lat: lat, lng: lng },
          path: pathPayload,
        },
        window.location.origin
      );
    } catch (e) {}
  }

  function postPdrToIndoorMap(lng, lat) {
    var pathPayload = buildPathPayload(lng, lat);
    try {
      if (typeof window.__ORIENTA_PDR_POST_TO_MAP__ === "function") {
        window.__ORIENTA_PDR_POST_TO_MAP__(lng, lat, pathPayload, st.headingRad);
        return;
      }
    } catch (eMapHook) {}
    try {
      var emb = window.__ORIENTA_ROUTE_SITE_INDOOR_EMBED__;
      if (!emb || !emb.iframe || !emb.iframe.contentWindow) return;
      var tgt = emb.targetOrigin === "*" ? "*" : emb.targetOrigin;
      emb.iframe.contentWindow.postMessage(
        {
          type: "orienta-pax-map-position",
          source: "pdr",
          position: { lat: lat, lng: lng },
          path: pathPayload,
          headingRad: st.headingRad,
        },
        tgt
      );
    } catch (e) {}
  }

  /** Map overlay: only PDR trail + marker (no planned polyline). */
  function buildMapSplit() {
    if (!st.active || !st.markerLngLat) return null;
    var coord = st.markerLngLat;
    var past = st.trail.length >= 2 ? st.trail.slice() : [[coord[0], coord[1]]];
    var last = past[past.length - 1];
    if (last[0] !== coord[0] || last[1] !== coord[1]) past.push(coord.slice());
    return {
      coord: coord,
      pastCoords: past,
      futureCoords: [coord, coord],
      si: 0,
      tt: 0,
      b: coord,
      n: 1,
      _pdrHeadingRad: st.headingRad,
    };
  }

  window.__ORIENTA_PDR__ = {
    active: false,
    buildMapSplit: buildMapSplit,
    /**
     * Snap anchor/marker to a known POI and reset backend state.
     * @param {number} lng
     * @param {number} lat
     * @param {number=} initialHeadingDeg - optional heading seed toward next POI.
     */
    snapReset: function (lng, lat, initialHeadingDeg) {
      try {
        if (!isFinite(lng) || !isFinite(lat)) return false;
        if (!st.active) return false;
        if (!st.anchorLngLat) st.anchorLngLat = [lng, lat];
        st.anchorLngLat = [lng, lat];
        st.markerLngLat = [lng, lat];
        st.trail = [[lng, lat]];
        st.lastTrailMs = Date.now();
        // Immediately publish the snapped position so parent/backoffice updates too.
        postTrajectoryToParent(lng, lat);
        postPdrToIndoorMap(lng, lat);
        if (st.socket && st.socket.readyState === WebSocket.OPEN) {
          var payload = { type: "reset", t_ms: Date.now() };
          if (typeof initialHeadingDeg === "number" && isFinite(initialHeadingDeg)) {
            payload.initial_heading_deg = initialHeadingDeg;
          }
          st.socket.send(JSON.stringify(payload));
        }
        return true;
      } catch (e) {
        return false;
      }
    },
    getState: function () {
      return st;
    },
  };

  async function requestSensorPermissions() {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      var a = await DeviceMotionEvent.requestPermission();
      if (a !== "granted") return false;
    }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      var b = await DeviceOrientationEvent.requestPermission();
      if (b !== "granted") return false;
    }
    return true;
  }

  function onOrientation(e) {
    st.lastOrientation = {
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      absolute: e.absolute,
      webkitCompassHeading: e.webkitCompassHeading,
    };
  }

  function attachSensorListeners() {
    if (st.motionHandler || st.orientHandler) return; // already attached
    st.motionHandler = onMotion;
    st.orientHandler = onOrientation;
    window.addEventListener("devicemotion", onMotion, { passive: true });
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
  }

  function detachSensorListeners() {
    if (st.motionHandler) window.removeEventListener("devicemotion", st.motionHandler);
    if (st.orientHandler) window.removeEventListener("deviceorientation", st.orientHandler);
    st.motionHandler = null;
    st.orientHandler = null;
  }

  function onMotion(e) {
    if (!st.socket || st.socket.readyState !== WebSocket.OPEN) return;
    var nowThrottle = Date.now();
    if (nowThrottle - st.lastFrameSentMs < MIN_FRAME_INTERVAL_MS) return;
    st.lastFrameSentMs = nowThrottle;
    st.motionEvents++;
    if (st.motionEvents === 1) {
      clearMotionWarnTimer();
      setPdrButtonState("imu");
      setStatus("IMU 正常 · 传感器数据已进入");
    }
    var rot = e.rotationRate;
    var accLin = e.acceleration;
    var accG = e.accelerationIncludingGravity;
    try {
      var frame = {
        type: "sensor_frame",
        t_ms: Date.now(),
        acc_linear:
          accLin && accLin.x != null
            ? { x: accLin.x, y: accLin.y, z: accLin.z }
            : null,
        acc_including_g: accG || { x: 0, y: 0, z: 0 },
        rotation_rate: rot
          ? { alpha: rot.alpha, beta: rot.beta, gamma: rot.gamma }
          : { alpha: null, beta: null, gamma: null },
        orientation: st.lastOrientation || {},
        map_match_enabled: st.mapMatch,
      };
      if (typeof window.orientaPdrRecorderHook === "function") {
        window.orientaPdrRecorderHook("sensor_frame", frame);
      }
      st.socket.send(JSON.stringify(frame));
    } catch (err) {}
  }

  function onSocketMessage(ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (typeof window.orientaPdrRecorderHook === "function") {
        window.orientaPdrRecorderHook("socket_message", msg);
        if (msg.type === "pose_update") window.orientaPdrRecorderHook("pose_update", msg);
      }
      if (msg.type !== "pose_update") return;
      if (!st.anchorLngLat) return;
      var pos = msg.position || {};
      var x = Number(pos.x);
      var y = Number(pos.y);
      if (!isFinite(x) || !isFinite(y)) return;
      var ll = metersToLngLat(st.anchorLngLat, x, y);
      st.markerLngLat = ll;
      var h = Number(msg.heading_deg);
      // Backend heading is compass-style: 0 = north, 90 = east. The marker arrow points east at 0rad.
      if (isFinite(h)) st.headingRad = ((h - 90) * Math.PI) / 180;
      var now = Date.now();
      if (st.trail.length === 0 || now - st.lastTrailMs > 250) {
        st.trail.push(ll.slice());
        st.lastTrailMs = now;
        if (st.trail.length > 800) st.trail.shift();
      }
      var steps = Number(msg.step_count);
      var dist = Number(msg.distance_m);
      var stepped = msg.stepped === true;
      if (isFinite(steps) && isFinite(dist)) {
        st.lastPose = {
          steps: steps,
          distanceM: dist,
          imuFrames: st.motionEvents,
          stepped: stepped,
          x: x,
          y: y,
          headingDeg: Number(msg.heading_deg),
          stepSignal: Number(msg.step_signal),
          stepLengthM: Number(msg.step_length_m),
          at: now,
        };
        try {
          window.__ORIENTA_PDR_LAST_POSE__ = st.lastPose;
        } catch (ePose) {}
        if (stepped || now - st.lastStatusMs > 600) {
          st.lastStatusMs = now;
          setStatus(dist.toFixed(1) + "m · " + steps + "步");
        }
      }
      postTrajectoryToParent(ll[0], ll[1]);
      postPdrToIndoorMap(ll[0], ll[1]);
    } catch (e) {}
  }

  async function startPdr() {
    // Also bail out while a reconnect is pending (st.active is already false
    // by then — onclose sets it before scheduling the reconnect timer) —
    // otherwise a tap on "start" during that window created a brand-new
    // backend session via a fresh POST /api/session while the old timer was
    // still going to fire connectPdrSocket() for the previous session,
    // leaving two overlapping sessions/sockets running at once.
    if (st.active || st.reconnectTimer != null) return;
    var anchor = resolvePdrAnchor();
    if (!anchor) {
      setStatus(
        "无 PDR 起点：① PEK 请在 URL 带 gateFrom（及 gateTo），如 gateFrom=E32&gateTo=E25。② 或写明 ?pdrOriginLat=纬度&pdrOriginLng=经度。③ 确认 route_site 地址栏含 airport=PEK（或 hub=PEK）。"
      );
      return;
    }
    try {
      var sp = new URLSearchParams(location.search);
      st.mapMatch = sp.get("pdrMapMatch") === "1" || sp.get("pdrMapMatch") === "true";
    } catch (e) {
      st.mapMatch = false;
    }

    setStatus("正在请求传感器权限…");
    var ok = false;
    try {
      ok = await requestSensorPermissions();
    } catch (permErr) {
      setStatus("传感器权限请求失败 · 请确认页面/iframe 允许运动与方向传感器");
      return;
    }
    if (!ok) {
      setStatus("传感器权限被拒绝");
      return;
    }
    setStatus("传感器权限已允许 · 连接服务器…");
    setPdrButtonState("off");

    var root = apiRoot();
    var sessionUrl = root + "/api/session";
    setStatus("连接 PDR…");
    var res;
    try {
      res = await fetch(sessionUrl, { method: "POST", headers: { Accept: "application/json" } });
    } catch (err) {
      setStatus("无法连接 PDR 服务 · 检查网络或后端是否已启动");
      return;
    }
    if (!res.ok) {
      var hint = "";
      try {
        var ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.indexOf("application/json") !== -1) {
          var ej = await res.json();
          if (ej && ej.message) hint = " · " + String(ej.message);
          else if (ej && ej.error) hint = " · " + String(ej.error);
        }
      } catch (e1) {}
      if (!hint && res.status === 502)
        hint = " · 上游 PDR 无响应（本地请启动 Python PDR 并监听 10000）";
      if (!hint && res.status === 404)
        hint =
          " · 常见原因：① 生产环境未设置 PDR_API_ORIGIN 或需重新部署 orienta；② PDR_API_ORIGIN / ?pdrBackend= 写成了 …/api（应写服务根 URL，如 https://orienta-pdr.onrender.com）；③ orienta-pdr 服务未启动";
      setStatus("创建会话失败 " + res.status + hint);
      return;
    }
    var data;
    try {
      data = await res.json();
    } catch (e2) {
      setStatus("PDR 返回非 JSON（请确认 /pdr-api 已指向 orienta-pdr，而非站点首页）");
      return;
    }
    var sid = data.session_id;
    if (!sid) {
      setStatus("无 session_id");
      return;
    }
    st.sessionId = sid;
    st.anchorLngLat = anchor.slice();
    st.trail = [];
    st.lastTrailMs = 0;
    st.markerLngLat = st.anchorLngLat.slice();
    st.headingRad = null;
    st.motionEvents = 0;
    clearMotionWarnTimer();

    connectPdrSocket(sid);
  }

  /**
   * Opens the PDR WebSocket for an existing session id. Split out from
   * startPdr() so a dropped connection can reconnect to the *same* session
   * (the backend keeps a disconnected session's PDR state — step count,
   * position — alive for a while; see pdr_airchina/backend/app.py
   * SESSION_TTL_S) instead of the user having to restart from zero.
   */
  function connectPdrSocket(sid) {
    var wsUrl = wsBaseUrl() + "/ws/pdr/" + encodeURIComponent(sid);
    var ws = new WebSocket(wsUrl);
    st.socket = ws;
    ws.onopen = function () {
      st.active = true;
      st.reconnectAttempt = 0;
      window.__ORIENTA_PDR__.active = true;
      setPdrButtonState("connected");
      setStatus("已连接 · 等待运动数据（请稍晃手机）");
      // Don't re-attach sensors if the page is currently hidden — visibility
      // handling will attach them the moment it becomes visible again.
      if (!st.pausedForVisibility) attachSensorListeners();
      clearMotionWarnTimer();
      st.motionWarnTimer = setTimeout(function () {
        st.motionWarnTimer = null;
        if (st.active && st.motionEvents === 0 && !st.pausedForVisibility) {
          setStatus("未收到 IMU · 请晃动手机或检查系统隐私设置");
        }
      }, 4000);
    };
    ws.onmessage = onSocketMessage;
    ws.onerror = function () {
      setStatus("WebSocket 错误");
      setPdrButtonState("off");
    };
    ws.onclose = function () {
      // A stale/superseded socket firing close (e.g. a delayed close event
      // for the OLD socket arriving after a reconnect already replaced
      // st.socket with a new, already-open one) must not touch any state at
      // all — checked first, before any side effect below, since a live
      // connection's "active"/sensors/UI state must never be clobbered by a
      // close event belonging to a socket that isn't current anymore.
      if (st.socket !== ws) return;
      clearMotionWarnTimer();
      st.active = false;
      window.__ORIENTA_PDR__.active = false;
      st.motionEvents = 0;
      detachSensorListeners();
      setPdrButtonState("off");
      st.socket = null;
      if (st.stopping) {
        st.stopping = false;
        return;
      }
      // Not an intentional stop — the user still wants PDR running (this
      // mirrors src/services/realtime.ts's reconnect-with-backoff pattern).
      // Reconnecting to the SAME sessionId resumes the backend's PDR state.
      if (st.sessionId) {
        setStatus("PDR 已断开 · 正在重连…");
        scheduleReconnect();
      } else {
        setStatus("PDR 已断开");
      }
    };
  }

  function scheduleReconnect() {
    if (st.reconnectTimer != null) return;
    var backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, st.reconnectAttempt));
    var jitter = backoff * (0.5 + Math.random() * 0.5);
    st.reconnectAttempt++;
    st.reconnectTimer = setTimeout(function () {
      st.reconnectTimer = null;
      if (!st.sessionId || st.stopping) return;
      connectPdrSocket(st.sessionId);
    }, jitter);
  }

  function stopPdr() {
    st.stopping = true;
    clearMotionWarnTimer();
    if (st.reconnectTimer != null) {
      clearTimeout(st.reconnectTimer);
      st.reconnectTimer = null;
    }
    st.reconnectAttempt = 0;
    st.motionEvents = 0;
    setPdrButtonState("off");
    if (st.socket) {
      try {
        st.socket.close();
      } catch (e) {}
    }
    st.socket = null;
    st.sessionId = null;
    st.active = false;
    window.__ORIENTA_PDR__.active = false;
    detachSensorListeners();
    st.pausedForVisibility = false;
    st.trail = [];
    st.markerLngLat = null;
    setStatus("");
  }

  /**
   * Pauses/resumes sensor listeners (not the WebSocket/session) when the page
   * is hidden — a locked screen or backgrounded app stops producing useful
   * devicemotion/deviceorientation events on most platforms anyway, so this
   * mainly avoids sending stale/garbage frames and gives the user an accurate
   * status instead of a silently stalled "connected" state. The session/
   * socket are left alone: if the OS itself kills the connection while
   * hidden, the existing onclose → scheduleReconnect() path handles that
   * independently, using the same still-known sessionId.
   */
  function onVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      if (!st.active || st.pausedForVisibility) return;
      st.pausedForVisibility = true;
      detachSensorListeners();
      clearMotionWarnTimer();
      setStatus("已暂停（页面不可见）");
    } else {
      if (!st.pausedForVisibility) return;
      st.pausedForVisibility = false;
      st.motionEvents = 0;
      if (st.active && st.socket && st.socket.readyState === WebSocket.OPEN) {
        attachSensorListeners();
        setStatus("已恢复 · 等待运动数据（请稍晃手机）");
        clearMotionWarnTimer();
        st.motionWarnTimer = setTimeout(function () {
          st.motionWarnTimer = null;
          if (st.active && st.motionEvents === 0 && !st.pausedForVisibility) {
            setStatus("未收到 IMU · 请晃动手机或检查系统隐私设置");
          }
        }, 4000);
      }
      // If the socket isn't open, onclose's reconnect path (already running)
      // will call attachSensorListeners() itself once it reconnects.
    }
  }

  try {
    document.addEventListener("visibilitychange", onVisibilityChange);
  } catch (eVis) {}

  function togglePdr() {
    // Treat "reconnect pending" the same as "active" for the toggle: the
    // button's only other option (startPdr) is now a deliberate no-op during
    // that window (see its comment), so without this a tap would otherwise
    // silently do nothing instead of letting the user cancel the retry.
    if (st.active || st.reconnectTimer != null) stopPdr();
    else startPdr().catch(function (e) {
      setStatus("启动失败: " + (e && e.message ? e.message : String(e)));
    });
  }

  window.__ORIENTA_PDR_START__ = startPdr;
  window.__ORIENTA_PDR_STOP__ = stopPdr;
  window.__ORIENTA_PDR_TOGGLE__ = togglePdr;
  window.__ORIENTA_PDR_IS_ACTIVE__ = function () {
    return !!st.active;
  };

  function bindUi() {
    var btn = document.getElementById("btnPdrImu");
    if (btn) btn.addEventListener("click", togglePdr);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi);
  else bindUi();
})();
