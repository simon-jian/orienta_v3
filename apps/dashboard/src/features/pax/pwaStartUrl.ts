/**
 * Home-screen / PWA start URL for passenger pages.
 *
 * The static manifest used to pin `/pax`, so "Add to Home Screen" always
 * opened the entry landing — not the claim link or /pax/app. iOS standalone
 * also does not share Safari sessionStorage, so that landing had no session.
 *
 * Keep the claim query (`?i=&t=`) only while the passenger is still on the
 * claim page; after redeem, `/pax/app` plus a persisted session is enough.
 * The hash is never included (the secret is already in `?t=`).
 */
export function passengerPwaStartUrl(pathname: string, search = ""): string {
  const path = pathname || "/";
  const qs = search && search !== "?" ? search : "";
  if (path.startsWith("/pax/claim") && /[?&]i=/.test(qs) && /[?&]t=/.test(qs)) {
    return `${path}${qs}`;
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
  if (path.startsWith("/pax/")) return `${path}${qs}`;
  return "/pax/app";
}
