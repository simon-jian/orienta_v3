/**
 * PNG QR for a passenger claim URL.
 *
 * Encodes the full string, including `#t=`. Do not log `url` — that is the
 * one-time secret. The PNG is meant to ride as a CID attachment so mail
 * clients do not have to fetch an image from us (which would drop the fragment).
 */
import QRCode from "qrcode";
import { logger } from "./logger";

export const INVITE_QR_CID = "orienta-invite-qr";
export const INVITE_QR_FILENAME = "orienta-trip-qr.png";

const QR_SIZE = 320;

const QR_OPTS = {
  width: QR_SIZE,
  margin: 2,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#111827", light: "#ffffff" },
};

export type InviteQr = {
  png: Buffer;
  dataUrl: string;
};

export async function renderInviteQr(url: string): Promise<InviteQr> {
  const png = await QRCode.toBuffer(url, { ...QR_OPTS, type: "png" });
  return { png, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
}

/** Same as renderInviteQr, but a QR failure must not block sending the link. */
export async function tryRenderInviteQr(url: string): Promise<InviteQr | null> {
  try {
    return await renderInviteQr(url);
  } catch (err) {
    logger.warn("invite_qr_failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}
