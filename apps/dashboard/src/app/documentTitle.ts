import { CONSOLE_TITLE } from "../config/branding";

/**
 * Browser tab title per route.
 *
 * The SPA shipped a single static title for the operator console, so a
 * passenger opening an invite link saw that name in their tab. Titles are
 * derived from the path instead, and index.html starts from a neutral
 * "Orienta" so the console name never flashes before React mounts.
 */
export function titleForPath(pathname: string): string {
  const path = (pathname || "/").toLowerCase();
  // Public arrival share: opened by whoever is meeting the passenger.
  if (path === "/arrival" || path.startsWith("/arrival/")) return "Orienta 到达信息";
  if (path === "/pax" || path.startsWith("/pax/")) return "Orienta 旅客端";
  return CONSOLE_TITLE;
}
