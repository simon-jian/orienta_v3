/**
 * Invite secret from a claim URL.
 *
 * Historically this lived only in `#t=`, which never hits server logs. Outlook
 * and most QR scanners strip the fragment before opening the page, so the
 * claim UI showed「无法打开链接」. We now accept `?t=` as well (and still
 * accept `#t=` for older links).
 */
export function readClaimToken(search: string, hash: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const fromQuery = new URLSearchParams(query).get("t");
  if (fromQuery) return fromQuery;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw).get("t") || "";
}
