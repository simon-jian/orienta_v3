import { CONSOLE_TITLE } from "../config/branding";
import { detectPaxLocale, paxMessage, type PaxLocale } from "../features/pax/i18n/locales";

/**
 * Browser tab title per route.
 *
 * The SPA shipped a single static title for the operator console, so a
 * passenger opening an invite link saw that name in their tab. Titles are
 * derived from the path instead, and index.html starts from a neutral
 * "Orienta" so the console name never flashes before React mounts.
 *
 * Passenger / arrival titles follow the OS language via `locale`.
 */
export function titleForPath(pathname: string, locale: PaxLocale = detectPaxLocale()): string {
  const path = (pathname || "/").toLowerCase();
  // Public arrival share: opened by whoever is meeting the passenger.
  if (path === "/arrival" || path.startsWith("/arrival/")) return paxMessage(locale, "title.arrival");
  if (path === "/pax" || path.startsWith("/pax/")) return paxMessage(locale, "title.pax");
  return CONSOLE_TITLE;
}
