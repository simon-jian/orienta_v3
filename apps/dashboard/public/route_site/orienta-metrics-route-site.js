/**
 * Auto-hooks for route_site/index.html (video + indoor map iframe).
 * Requires orienta-metrics.js loaded first.
 */
(function () {
  "use strict";
  if (typeof OrientaMetrics === "undefined") return;

  function hookVideoEl(v) {
    if (!v || v.__orientaMetricsVideoHooked) return;
    v.__orientaMetricsVideoHooked = true;
    var loadMark = null;
    var srcObserver = function () {
      if (!v.src || v.src === "about:blank") return;
      loadMark = OrientaMetrics.start("pax.video.load", "video", { role: "pax", props: { src: String(v.src).slice(-80) } });
    };
    v.addEventListener("loadstart", srcObserver);
    v.addEventListener("canplay", function onCanplay() {
      if (loadMark) {
        loadMark.end({ ok: true });
        loadMark = null;
      }
    });
    v.addEventListener("error", function () {
      OrientaMetrics.emit({
        name: "pax.video.load",
        category: "video",
        role: "pax",
        ok: false,
        props: { src: String(v.src || "").slice(-80) },
      });
      loadMark = null;
    });
    if (v.src && v.src !== "about:blank") srcObserver();
  }

  function hookIndoorMount() {
    var orig = window.orientaMountIndoorEmbedInMapPeople_;
    if (typeof orig !== "function" || orig.__orientaMetricsWrapped) return;
    window.orientaMountIndoorEmbedInMapPeople_ = function (mapEl, baseUrl, apiBase, tileBase, tileUrl) {
      var t0 = Date.now();
      orig.apply(this, arguments);
      setTimeout(function () {
        var ifr = document.getElementById("orientaRouteSiteIndoorEmbed");
        if (!ifr || ifr.__orientaMetricsMapHooked) return;
        ifr.__orientaMetricsMapHooked = true;
        ifr.addEventListener("load", function () {
          OrientaMetrics.emit({
            name: "pax.map.indoor_embed_load",
            category: "map",
            role: "pax",
            durationMs: Date.now() - t0,
            ok: true,
          });
        });
        ifr.addEventListener("error", function () {
          OrientaMetrics.emit({
            name: "pax.map.indoor_embed_load",
            category: "map",
            role: "pax",
            durationMs: Date.now() - t0,
            ok: false,
          });
        });
      }, 0);
    };
    window.orientaMountIndoorEmbedInMapPeople_.__orientaMetricsWrapped = true;
  }

  function init() {
    hookIndoorMount();
    var vid = document.getElementById("vid");
    if (vid) hookVideoEl(vid);
    else {
      document.addEventListener("DOMContentLoaded", function () {
        hookVideoEl(document.getElementById("vid"));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-wrap if inline script defines mount later (same tick)
  setTimeout(hookIndoorMount, 0);
  setTimeout(hookIndoorMount, 50);
})();
