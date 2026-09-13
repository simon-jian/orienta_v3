/**
 * Air China lockup for invite email (CID inline). Outlook does not render SVG
 * and often blocks remote images, so this is the same PNG already in public/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_DIR } from "../paths";
import { logger } from "./logger";

export const INVITE_LOGO_CID = "airchina-logo";
export const INVITE_LOGO_FILENAME = "airchina-logo.png";

const LOGO_PATH = path.join(PUBLIC_DIR, INVITE_LOGO_FILENAME);

export function tryLoadInviteLogo(): Buffer | null {
  try {
    const png = readFileSync(LOGO_PATH);
    if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
    return png;
  } catch (err) {
    logger.warn("invite_logo_missing", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}
