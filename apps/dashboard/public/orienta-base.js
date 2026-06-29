/**
 * Orienta deploy base path (/orienta for 国航云). Loaded first in every HTML page.
 * Sets window.orientaUrl / window.orientaWsUrl and patches fetch + sendBeacon for root paths.
 */
(function () {
  "use strict";

  function normalizeBase(raw) {
    var s = String(raw || "").trim();
    if (!s || s === "/") return "";
    return (s.charAt(0) === "/" ? s : "/" + s).replace(/\/$/, "");
  }

  function detectBaseFromPath() {
    try {
      var p = location.pathname || "";
      var markers = [
        "/route_site/",
        "/index.html",
        "/lounge-qr.html",
        "/lounge",
        "/pax",
      ];
      for (var i = 0; i < markers.length; i++) {
        var m = markers[i];
        var idx = p.indexOf(m);
        if (idx > 0) return p.slice(0, idx);
      }
      if (p.endsWith("/orienta") || p.endsWith("/orienta/")) return "/orienta";
    } catch (e) {}
    return "";
  }

  var B = normalizeBase(typeof window.__ORIENTA_BASE__ === "string" ? window.__ORIENTA_BASE__ : "");
  if (!B) {
    var meta = document.querySelector('meta[name="orienta-base-path"]');
    if (meta && meta.getAttribute("content")) B = normalizeBase(meta.getAttribute("content"));
  }
  if (!B) B = detectBaseFromPath();
  window.__ORIENTA_BASE__ = B;

  function orientaUrl(path) {
    if (path == null || path === "") return B || "/";
    if (/^https?:\/\//i.test(path)) return path;
    var p = String(path).charAt(0) === "/" ? String(path) : "/" + path;
    if (B && p.indexOf(B + "/") === 0) return p;
    return (B || "") + p;
  }

  function orientaWsUrl() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    return proto + "://" + location.host + orientaUrl("/ws");
  }

  window.orientaUrl = orientaUrl;
  window.orientaWsUrl = orientaWsUrl;

  function shouldPrefix(url) {
    if (typeof url !== "string") return false;
    if (url.charAt(0) !== "/") return false;
    if (url.charAt(1) === "/") return false;
    if (B && url.indexOf(B + "/") === 0) return false;
    return true;
  }

  if (B && typeof window.fetch === "function" && !window.__ORIENTA_FETCH_PATCHED__) {
    window.__ORIENTA_FETCH_PATCHED__ = true;
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      if (typeof input === "string" && shouldPrefix(input)) return _fetch(orientaUrl(input), init);
      if (typeof Request !== "undefined" && input instanceof Request) {
        var u = input.url;
        if (shouldPrefix(u)) return _fetch(new Request(orientaUrl(u), input), init);
      }
      return _fetch(input, init);
    };
  }

  if (B && navigator.sendBeacon && !window.__ORIENTA_BEACON_PATCHED__) {
    window.__ORIENTA_BEACON_PATCHED__ = true;
    var _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return _beacon(shouldPrefix(url) ? orientaUrl(url) : url, data);
    };
  }

  if (B && typeof XMLHttpRequest !== "undefined" && !window.__ORIENTA_XHR_PATCHED__) {
    window.__ORIENTA_XHR_PATCHED__ = true;
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      if (typeof url === "string" && shouldPrefix(url)) {
        return _open.apply(this, [method, orientaUrl(url)].concat(rest));
      }
      return _open.apply(this, arguments);
    };
  }
})();
