/**
 * route_site config bootstrap (Multi-airport Phase 4).
 *
 * Resolves the hub from ?airport=/?hub= (PEK-only today) and exposes
 * window.__ROUTESITE_CONFIG__ for route-site-app.js. A built-in PEK config makes
 * this synchronous + offline-safe; config/<hub>.json refines it asynchronously
 * (same values today, but the externalized source of truth going forward).
 *
 * Must load before route-site-app.js (it does — see index.html script order).
 */
(function () {
  "use strict";

  // Keep in sync with config/pek.json. Used synchronously so the app never waits.
  var BUILTIN = {
    PEK: {
      hubKey: "PEK",
      tenantId: "airchina",
      terminal: "T3E",
      poiTerminalQuery: "T3E",
      defaultRouteGates: { from: "E16", to: "E19" },
      paxAliases: { DA8X3: "TX1", DB5K7: "TX3", DC2N9: "TX2" },
      video: {
        gateCsv: "PEK_gate_timestamp_full_with_E24_E36.csv",
        mergedFromCsvBasename: "PEK_gate_timestamp_merged.mp4",
        mergeEndpoint: "/api/orienta/pek-merged-video",
      },
      pathLonLatFallback: [
        [116.610013, 40.079188],
        [116.609573, 40.07885],
        [116.608943, 40.078642],
        [116.608302, 40.07826],
        [116.607674, 40.077897],
      ],
    },
  };

  var sp = new URLSearchParams(location.search);
  var requested = (sp.get("airport") || sp.get("hub") || "PEK").toUpperCase();

  // Only PEK is supported today; anything else falls back to PEK (logged).
  var hub = "PEK";
  if (requested !== "PEK") {
    console.warn("[route_site] Only PEK is supported; ignoring hub/airport=", requested);
  }

  window.__ROUTESITE_HUB__ = hub;
  window.__ROUTESITE_CONFIG__ = BUILTIN[hub] || BUILTIN.PEK;

  // Async refine from the externalized JSON (relative to /route_site/).
  try {
    fetch("config/" + hub.toLowerCase() + ".json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j === "object") window.__ROUTESITE_CONFIG__ = j; })
      .catch(function () {});
  } catch (e) { /* ignore */ }
})();
