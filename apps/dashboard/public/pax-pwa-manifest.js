/**
 * Replace the static manifest start_url before the browser snapshots the PWA.
 * Keep in sync with src/features/pax/pwaStartUrl.ts.
 */
(function () {
  function passengerPwaStartUrl(pathname, search) {
    var path = pathname || "/";
    var qs = search && search !== "?" ? search : "";
    if (path.indexOf("/pax/claim") === 0 && /[?&]i=/.test(qs) && /[?&]t=/.test(qs)) {
      return path + qs;
    }
    if (
      path === "/pax" ||
      path === "/pax/" ||
      path === "/pax/login" ||
      path === "/pax/claim" ||
      path === "/pax/claim/"
    ) {
      return "/pax/app";
    }
    if (path.indexOf("/pax/") === 0) return path + qs;
    return "/pax/app";
  }

  var start = passengerPwaStartUrl(location.pathname, location.search);
  var manifest = {
    name: "Orienta Passenger",
    short_name: "Orienta",
    start_url: start,
    scope: "/pax",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#c8102e",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
  var url = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }),
  );
  var link = document.querySelector('link[rel="manifest"]');
  if (link) link.setAttribute("href", url);
  else {
    link = document.createElement("link");
    link.rel = "manifest";
    link.href = url;
    document.head.appendChild(link);
  }
})();
