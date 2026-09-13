import { describe, expect, it } from "vitest";
import { formatCallSummary, formatVoiceNoteBody, parseVoiceNoteBody } from "./voiceNoteBody";

describe("voice note body", () => {
  it("round-trips id and duration", () => {
    const body = formatVoiceNoteBody("11111111-2222-4333-8444-555555555555", 12);
    expect(parseVoiceNoteBody(body)).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      durationSec: 12,
    });
  });

  it("formats a call summary clock", () => {
    expect(formatCallSummary("audio", 72_000)).toBe("Voice call · 1:12");
    expect(formatCallSummary("video", 5_000)).toBe("Video call · 0:05");
  });
});
