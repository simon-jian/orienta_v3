/**
 * Passenger invite claim URL.
 *
 * `t` is in the query string so Outlook buttons and QR scanners keep it
 * (they drop `#t=`). `#t=` is repeated for older links. Do not log `url`.
 */
export function buildInviteClaimUrl(origin: string, inviteId: string, token: string): string {
  const i = encodeURIComponent(inviteId);
  const t = encodeURIComponent(token);
  return `${origin}/pax/claim?i=${i}&t=${t}#t=${t}`;
}

export function claimTokenFromUrl(parsed: URL): string {
  const fromQuery = parsed.searchParams.get("t");
  if (fromQuery) return fromQuery;
  const raw = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  return new URLSearchParams(raw).get("t") || "";
}
