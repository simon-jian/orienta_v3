import { describe, expect, it, vi } from "vitest";
import {
  acquireErrorCode,
  acquireLocalStream,
  classifyGetUserMediaError,
  isLikelyNonRgbCamera,
  MediaAcquireError,
  mediaEnvironment,
  prefersAvThenStripAudio,
  takeUsableVideoTrack,
  videoTrackLooksUsable,
  wakeVideoTrack,
} from "./localMedia";

describe("mediaEnvironment", () => {
  it("reports insecure when the page is not a secure context", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
    expect(mediaEnvironment()).toBe("insecure");
    vi.unstubAllGlobals();
  });

  it("reports unavailable when getUserMedia is missing", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: {} });
    expect(mediaEnvironment()).toBe("unavailable");
    vi.unstubAllGlobals();
  });
});

describe("classifyGetUserMediaError", () => {
  it("maps browser permission names", () => {
    expect(classifyGetUserMediaError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyGetUserMediaError({ name: "NotFoundError" })).toBe("notfound");
    expect(classifyGetUserMediaError({ name: "NotReadableError" })).toBe("inuse");
  });

  it("unwraps MediaAcquireError", () => {
    expect(acquireErrorCode(new MediaAcquireError("insecure"))).toBe("insecure");
  });
});

describe("camera labels", () => {
  it("skips IR and dummy nodes that look like a camera but have no RGB picture", () => {
    expect(isLikelyNonRgbCamera("Integrated IR Camera")).toBe(true);
    expect(isLikelyNonRgbCamera("USB Infrared Camera")).toBe(true);
    expect(isLikelyNonRgbCamera("Dummy video device (0x0000)")).toBe(true);
    expect(isLikelyNonRgbCamera("Integrated Camera")).toBe(false);
    expect(isLikelyNonRgbCamera("HD WebCam")).toBe(false);
  });

  it("rejects a live track with 0×0 settings", () => {
    const dead = {
      readyState: "live",
      label: "Integrated Camera",
      getSettings: () => ({ width: 0, height: 0 }),
    } as MediaStreamTrack;
    expect(videoTrackLooksUsable(dead)).toBe(false);
  });

  it("drops IR tracks from a mixed stream", () => {
    const ir = {
      id: "ir",
      readyState: "live",
      label: "Integrated IR Camera",
      getSettings: () => ({ width: 340, height: 340 }),
      stop: vi.fn(),
    };
    const rgb = {
      id: "rgb",
      readyState: "live",
      label: "Integrated Camera",
      getSettings: () => ({ width: 1280, height: 720 }),
      stop: vi.fn(),
    };
    const tracks = [ir, rgb];
    const stream = {
      getVideoTracks: () => tracks.filter((t) => tracks.includes(t)),
      removeTrack: (t: { id: string }) => {
        const i = tracks.findIndex((x) => x.id === t.id);
        if (i >= 0) tracks.splice(i, 1);
      },
    } as unknown as MediaStream;
    expect(takeUsableVideoTrack(stream)?.id).toBe("rgb");
    expect(ir.stop).toHaveBeenCalled();
  });

  it("applies a size when the track starts at 0×0", async () => {
    let width = 0;
    const track = {
      readyState: "live",
      label: "Integrated Camera",
      getSettings: () => ({ width, height: width ? 720 : 0 }),
      applyConstraints: vi.fn(async () => { width = 1280; }),
    } as unknown as MediaStreamTrack;
    await expect(wakeVideoTrack(track)).resolves.toBe(true);
    expect(track.applyConstraints).toHaveBeenCalled();
  });
});

describe("acquireLocalStream", () => {
  it("keeps video mode when only the microphone can be opened", async () => {
    const audioOnly = {
      getTracks: () => [{ kind: "audio" }],
      getVideoTracks: () => [],
      addTrack: () => undefined,
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      if (c.video) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
      return audioOnly;
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
    });
    const got = await acquireLocalStream("video");
    expect(got.mode).toBe("video");
    expect(got.cameraMissing).toBe(true);
    vi.unstubAllGlobals();
  });

  it("opens a bare video:true stream on the first successful attempt", async () => {
    const stream = {
      getTracks: () => [{ kind: "audio" }, { kind: "video" }],
      getVideoTracks: () => [{ kind: "video" }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
    const got = await acquireLocalStream("video");
    expect(got.mode).toBe("video");
    expect(got.cameraMissing).toBe(false);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    vi.unstubAllGlobals();
  });

  it("keeps the mic and opens a later RGB camera when the first device is IR", async () => {
    const ir = {
      id: "ir",
      kind: "video",
      label: "Integrated IR Camera",
      readyState: "live",
      getSettings: () => ({ width: 340, height: 340 }),
      stop: vi.fn(),
    };
    const rgb = {
      id: "rgb",
      kind: "video",
      label: "Integrated Camera",
      readyState: "live",
      getSettings: () => ({ width: 1280, height: 720 }),
      stop: vi.fn(),
    };
    const audio = { id: "a", kind: "audio", stop: vi.fn() };
    const comboTracks: unknown[] = [audio, ir];
    const combo = {
      getTracks: () => comboTracks,
      getVideoTracks: () => comboTracks.filter((t) => (t as { kind: string }).kind === "video"),
      addTrack: (t: unknown) => { comboTracks.push(t); },
      removeTrack: (t: { id: string }) => {
        const i = comboTracks.findIndex((x) => (x as { id: string }).id === t.id);
        if (i >= 0) comboTracks.splice(i, 1);
      },
    };
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      const video = c.video as MediaTrackConstraints | boolean | undefined;
      if (video && typeof video === "object" && video.deviceId && typeof video.deviceId === "object" && "exact" in video.deviceId && video.deviceId.exact === "rgb-id") {
        return { getVideoTracks: () => [rgb], getTracks: () => [rgb] } as unknown as MediaStream;
      }
      if (c.video) return combo as unknown as MediaStream;
      return combo as unknown as MediaStream;
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "ir-id", label: "Integrated IR Camera" },
          { kind: "videoinput", deviceId: "rgb-id", label: "Integrated Camera" },
        ],
      },
    });
    const got = await acquireLocalStream("video");
    expect(got.cameraMissing).toBe(false);
    expect(got.stream.getVideoTracks().some((t) => t.id === "rgb")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("still throws when the microphone itself is blocked", async () => {
    const getUserMedia = vi.fn()
      .mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
    await expect(acquireLocalStream("video")).rejects.toMatchObject({ code: "denied" });
    vi.unstubAllGlobals();
  });

  it("opens a bare audio stream for voice calls", async () => {
    const stream = {
      getAudioTracks: () => [{ kind: "audio" }],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, userAgent: "Mozilla/5.0" });
    const got = await acquireLocalStream("audio");
    expect(got.mode).toBe("audio");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    vi.unstubAllGlobals();
  });

  it("never opens the camera first on iPhone voice calls", async () => {
    const stream = {
      getAudioTracks: () => [{ kind: "audio" }],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      if (c.video) throw new Error("camera must not be requested for voice");
      return stream;
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      maxTouchPoints: 5,
      platform: "iPhone",
    });
    const got = await acquireLocalStream("audio");
    expect(got.mode).toBe("audio");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(getUserMedia).not.toHaveBeenCalledWith({ audio: true, video: true });
    vi.unstubAllGlobals();
  });

  it("falls back to audio+video and strips the camera when audio-only getUserMedia fails", async () => {
    const video = { kind: "video", stop: vi.fn() };
    const audio = { kind: "audio" };
    const tracks = [audio, video];
    const stream = {
      getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
      getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
      removeTrack: (t: { kind: string }) => {
        const i = tracks.indexOf(t as typeof tracks[number]);
        if (i >= 0) tracks.splice(i, 1);
      },
    };
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      if (c.video) return stream as unknown as MediaStream;
      throw Object.assign(new Error("audio only"), { name: "NotFoundError" });
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, userAgent: "Mozilla/5.0" });
    const got = await acquireLocalStream("audio");
    expect(got.mode).toBe("audio");
    expect(got.stream.getVideoTracks()).toEqual([]);
    expect(video.stop).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("prefersAvThenStripAudio", () => {
  it("treats iPhone, iPadOS desktop-UA, and Safari as needing the video fallback", () => {
    expect(prefersAvThenStripAudio("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, "iPhone")).toBe(true);
    expect(prefersAvThenStripAudio("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "MacIntel")).toBe(true);
    expect(prefersAvThenStripAudio("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0, "MacIntel")).toBe(true);
    expect(prefersAvThenStripAudio("Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36", 0, "Linux x86_64")).toBe(false);
  });
});
