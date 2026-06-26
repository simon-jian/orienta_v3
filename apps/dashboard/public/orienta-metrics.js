/**
 * Shared client metrics SDK (pax.html, route_site, static pages).
 * Batches events and POSTs to /api/metrics/events; uses sendBeacon on page hide.
 */
(function (global) {
  "use strict";

  var queue = [];
  var flushTimer = null;
  var FLUSH_MS = 2500;
  var MAX_BATCH = 40;

  function roleFromPath() {
    try {
      var p = String(global.location && global.location.pathname || "");
      if (/\/pax(\.html)?(\/|$)/i.test(p)) return "pax";
    } catch (e) {}
    return "pax";
  }

  function defaultRole() {
    return roleFromPath();
  }

  function emit(ev) {
    if (!ev || !ev.name) return;
    queue.push({
      name: String(ev.name),
      ts: typeof ev.ts === "number" ? ev.ts : Date.now(),
      role: ev.role || defaultRole(),
      category: ev.category || "other",
      durationMs: typeof ev.durationMs === "number" ? ev.durationMs : undefined,
      ok: typeof ev.ok === "boolean" ? ev.ok : undefined,
      props: ev.props && typeof ev.props === "object" ? ev.props : undefined,
    });
    if (queue.length >= MAX_BATCH) flush();
    else scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, FLUSH_MS);
  }

  function flush() {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    var body = JSON.stringify({ events: batch });
    var url =
      typeof global.orientaUrl === "function" ? global.orientaUrl("/api/metrics/events") : "/api/metrics/events";
    try {
      if (global.navigator && global.navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        if (global.navigator.sendBeacon(url, blob)) return;
      }
    } catch (eB) {}
    try {
      global.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (eF) {}
  }

  function start(name, category, opts) {
    var t0 = Date.now();
    var base = opts || {};
    return {
      end: function (extra) {
        var ex = extra || {};
        emit({
          name: name,
          category: category || base.category || "other",
          role: ex.role || base.role,
          durationMs: Date.now() - t0,
          ok: ex.ok !== false,
          props: Object.assign({}, base.props, ex.props),
        });
      },
      cancel: function () {
        t0 = 0;
      },
    };
  }

  function recordError(name, err, opts) {
    var o = opts || {};
    var msg = err && (err.message || err.reason || String(err)) || "unknown";
    emit({
      name: name || "client.error",
      category: "error",
      role: o.role,
      ok: false,
      props: Object.assign({ message: msg }, o.props),
    });
  }

  try {
    global.addEventListener("pagehide", flush);
    global.addEventListener("visibilitychange", function () {
      if (global.document && global.document.visibilityState === "hidden") flush();
    });
    global.addEventListener("error", function (ev) {
      recordError("client.js_error", ev.error || ev.message, {
        props: { source: ev.filename, line: ev.lineno, col: ev.colno },
      });
    });
    global.addEventListener("unhandledrejection", function (ev) {
      recordError("client.unhandled_rejection", ev.reason);
    });
  } catch (eHook) {}

  global.OrientaMetrics = {
    emit: emit,
    start: start,
    flush: flush,
    recordError: recordError,
  };
})(typeof window !== "undefined" ? window : globalThis);
