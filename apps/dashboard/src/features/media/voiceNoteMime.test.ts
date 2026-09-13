import { describe, expect, it } from "vitest";
import { pickVoiceRecorderMime, typedAudioBlob } from "./voiceNoteMime";

describe("pickVoiceRecorderMime", () => {
  it("prefers mp4 on Apple so iPad can play its own recordings", () => {
    const supported = (type: string) => type === "audio/mp4" || type.startsWith("audio/webm");
    expect(pickVoiceRecorderMime(supported, true)).toBe("audio/mp4");
    expect(pickVoiceRecorderMime(supported, false)).toBe("audio/webm;codecs=opus");
  });
});

describe("typedAudioBlob", () => {
  it("rewrites a blob that arrived without an audio Content-Type", () => {
    const raw = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });
    const typed = typedAudioBlob(raw, "audio/mp4");
    expect(typed.type).toBe("audio/mp4");
  });
});
