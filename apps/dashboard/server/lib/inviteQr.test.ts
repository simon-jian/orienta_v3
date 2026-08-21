import { describe, expect, it } from "vitest";
import { renderInviteQr } from "./inviteQr";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderInviteQr", () => {
  it("encodes the full claim URL as a PNG", async () => {
    const url = "https://ops.example.com/pax/claim?i=inv_1#t=secret-token";
    const qr = await renderInviteQr(url);
    expect(qr.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(qr.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(qr.png.length).toBeGreaterThan(200);
  });
});
