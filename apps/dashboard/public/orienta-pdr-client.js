/**
 * Video page / Pax app: phone IMU → PDR Python backend (pedestrian_dead_reckoning,
 * a separate service — see that repo's backend/README.md for the wire protocol) →
 * map trajectory. Thin client only: no step-detection/heading/route logic lives here.
 *
 * The backend has no free-walk mode — every session must follow a pre-planned
 * route (local x/y meters, ≥2 points), so this client refuses to start without
 * one. That route comes from the embedded indoor map's own gate-to-gate routing
 * (`gateFrom`/`gateTo` → map posts `orienta-nav-path-lonlat`, which route_site
 * already listens for and stores as `window.__ORIENTA_PATH_LONLAT_FROM_MAP__`
 * independently of PDR) — see resolvePlannedPathLngLat() below. A caller that
 * has its own route (e.g. PaxAppPage.tsx) can instead set
 * `window.__ORIENTA_PDR_PLANNED_PATH__` (array of [lng,lat] or {lat,lng}
 * pairs) before calling start.
 *
 * Same-origin: /pdr-api. ?pdrBackend= overrides the backend root for testing.
 */
(function () {
  var R_EARTH = 6378137;

  /** [lng, lat][], ≥2 points, or null. Explicit override first, then the map's own last-computed route. */
  function resolvePlannedPathLngLat() {
    var explicit = normalizeLngLatPairs(window.__ORIENTA_PDR_PLANNED_PATH__);
    if (explicit) return explicit;
    return normalizeLngLatPairs(window.__ORIENTA_PATH_LONLAT_FROM_MAP__);
  }

  function normalizeLngLatPairs(raw) {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      var lng, lat;
      if (Array.isArray(p) && p.length >= 2) {
        lng = Number(p[0]);
        lat = Number(p[1]);
      } else if (p && typeof p === "object") {
        lng = Number(p.lng);
        lat = Number(p.lat);
      } else continue;
      if (!isFinite(lng) || !isFinite(lat)) continue;
      out.push([lng, lat]);
    }
    return out.length >= 2 ? out : null;
  }

  /** True once a planned route is available — callers (e.g. React UI) can use
   *  this to enable/disable a "Start PDR" control without duplicating the
   *  resolution logic above. */
  function hasPlannedRoute() {
    return !!resolvePlannedPathLngLat();
  }

  /** Exact algebraic inverse of metersToLngLat() below, so converting a
   *  point through both directions round-trips exactly (critical for the
   *  path's own first point, which becomes the local (0, 0) origin). */
  function lngLatToMeters(anchor, lng, lat) {
    var lat1 = (anchor[1] * Math.PI) / 180;
    var y = (((lat - anchor[1]) * Math.PI) / 180) * R_EARTH;
    var x = (((lng - anchor[0]) * Math.PI) / 180) * R_EARTH * Math.cos(lat1);
    return { x: x, y: y };
  }

  function metersToLngLat(anchor, x, y) {
    var lng0 = anchor[0];
    var lat0 = anchor[1];
    var lat1 = (lat0 * Math.PI) / 180;
    var dLat = (y / R_EARTH) * (180 / Math.PI);
    var dLng = (x / (R_EARTH * Math.cos(lat1))) * (180 / Math.PI);
    return [lng0 + dLng, lat0 + dLat];
  }

  /** anchor = the route's own first point, so the backend's local (0,0) lines
   *  up with where the map says the route actually starts. */
  function buildPlannedPath(pathLngLat) {
    var anchor = pathLngLat[0];
    var points = [];
    for (var i = 0; i < pathLngLat.length; i++) {
      var m = lngLatToMeters(anchor, pathLngLat[i][0], pathLngLat[i][1]);
      points.push({ x: m.x, y: m.y });
    }
    return { anchor: anchor, points: points };
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

  /** Cap outbound sensor-frame rate — devicemotion can fire far faster than the
   *  PDR step-detection algorithm needs (min step period is 350ms server-side),
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
    anchorLngLat: null,
    markerLngLat: null,
    trail: [],
    headingRad: null,
    motionHandler: null,
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

  window.__ORIENTA_PDR__ = {
    active: false,
    hasPlannedRoute: hasPlannedRoute,
    /** Restarts progress from the beginning of the *same* planned route
     *  (does not change routes or re-anchor) — mirrors the backend's
     *  `reset` message; see backend/pdr/session.py's `PdrSession.reset()`. */
    reset: function () {
      if (!st.active || !st.socket || st.socket.readyState !== WebSocket.OPEN) return false;
      try {
        st.socket.send(JSON.stringify({ type: "reset", t_ms: Date.now() }));
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
    // Orientation/compass is never sent to this backend (see module docstring)
    // and isn't read locally either, so only motion needs a permission prompt.
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      var a = await DeviceMotionEvent.requestPermission();
      if (a !== "granted") return false;
    }
    return true;
  }

  function attachSensorListeners() {
    if (st.motionHandler) return; // already attached
    st.motionHandler = onMotion;
    window.addEventListener("devicemotion", onMotion, { passive: true });
  }

  function detachSensorListeners() {
    if (st.motionHandler) window.removeEventListener("devicemotion", st.motionHandler);
    st.motionHandler = null;
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
    var acc = e.acceleration;
    var accG = e.accelerationIncludingGravity;
    var rot = e.rotationRate;
    try {
      var frame = {
        type: "sensor_motion",
        t_ms: Date.now(),
        acceleration: acc && acc.x != null ? { x: acc.x, y: acc.y, z: acc.z } : null,
        acceleration_including_gravity: accG && accG.x != null ? { x: accG.x, y: accG.y, z: accG.z } : null,
        rotation_rate: rot
          ? { alpha: rot.alpha, beta: rot.beta, gamma: rot.gamma }
          : { alpha: null, beta: null, gamma: null },
      };
      if (typeof window.orientaPdrRecorderHook === "function") {
        window.orientaPdrRecorderHook("sensor_motion", frame);
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
      var deviating = msg.deviation_warning === true;
      if (isFinite(steps) && isFinite(dist)) {
        st.lastPose = {
          steps: steps,
          distanceM: dist,
          imuFrames: st.motionEvents,
          stepped: stepped,
          x: x,
          y: y,
          headingDeg: Number(msg.heading_deg),
          stepLengthM: Number(msg.step_length_m),
          deviationWarning: deviating,
          deviationTurnDirection: msg.deviation_turn_direction || null,
          at: now,
        };
        try {
          window.__ORIENTA_PDR_LAST_POSE__ = st.lastPose;
        } catch (ePose) {}
        if (stepped || now - st.lastStatusMs > 600) {
          st.lastStatusMs = now;
          var suffix = deviating ? " · 可能已偏离路线" : "";
          setStatus(dist.toFixed(1) + "m · " + steps + "步" + suffix);
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

    var pathLngLat = resolvePlannedPathLngLat();
    if (!pathLngLat) {
      setStatus(
        "无可用路线：PDR 需要地图先算出一条路径。请确认 URL 带 gateFrom（及 gateTo），如 gateFrom=E32&gateTo=E25，且地图已加载完成。"
      );
      return;
    }
    var planned = buildPlannedPath(pathLngLat);

    setStatus("正在请求传感器权限…");
    var ok = false;
    try {
      ok = await requestSensorPermissions();
    } catch (permErr) {
      setStatus("传感器权限请求失败 · 请确认页面/iframe 允许运动传感器");
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
      res = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ planned_path: planned.points }),
      });
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
          if (ej && ej.detail) hint = " · " + String(ej.detail);
          else if (ej && ej.message) hint = " · " + String(ej.message);
        }
      } catch (e1) {}
      if (!hint && res.status === 502) hint = " · 上游 PDR 无响应（请确认 PDR 后端已启动）";
      if (!hint && res.status === 404)
        hint =
          " · 常见原因：① 未设置 PDR_API_ORIGIN 或需重新部署 orienta；② PDR_API_ORIGIN / ?pdrBackend= 写成了 …/api（应写服务根 URL）；③ PDR 服务未启动";
      setStatus("创建会话失败 " + res.status + hint);
      return;
    }
    var data;
    try {
      data = await res.json();
    } catch (e2) {
      setStatus("PDR 返回非 JSON（请确认 /pdr-api 已指向 PDR 服务，而非站点首页）");
      return;
    }
    var sid = data.session_id;
    if (!sid) {
      setStatus("无 session_id");
      return;
    }
    st.sessionId = sid;
    st.anchorLngLat = planned.anchor.slice();
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
   * position — alive for a while; see the PDR backend's SESSION_TTL_SECONDS
   * in backend/app.py) instead of the user having to restart from zero.
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
   * devicemotion events on most platforms anyway, so this mainly avoids
   * sending stale/garbage frames and gives the user an accurate status
   * instead of a silently stalled "connected" state. The session/socket are
   * left alone: if the OS itself kills the connection while hidden, the
   * existing onclose → scheduleReconnect() path handles that independently,
   * using the same still-known sessionId.
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
  window.__ORIENTA_PDR_HAS_ROUTE__ = hasPlannedRoute;

  function bindUi() {
    var btn = document.getElementById("btnPdrImu");
    if (btn) btn.addEventListener("click", togglePdr);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi);
  else bindUi();
})();
