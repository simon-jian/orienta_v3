import { describe, expect, it } from "vitest";
import { addIncomingTrack, isSelfCallEcho, needsRecvOnlyVideoLine, shouldApplyRemoteSdp, shouldBufferRemoteOffer, shouldIgnoreNewStartCall, shouldRejectConcurrentInvite } from "./callSignaling";

describe("isSelfCallEcho", () => {
  it("drops frames the local role just sent", () => {
    expect(isSelfCallEcho("pax", { from: "pax" })).toBe(true);
    expect(isSelfCallEcho("admin", { from: "admin" })).toBe(true);
    expect(isSelfCallEcho("pax", { from: "admin" })).toBe(false);
    expect(isSelfCallEcho("pax", {})).toBe(false);
  });
});

describe("shouldApplyRemoteSdp", () => {
  it("lets only the callee apply an offer and only the initiator apply an answer", () => {
    expect(shouldApplyRemoteSdp(true, "offer")).toBe(false);
    expect(shouldApplyRemoteSdp(true, "answer")).toBe(true);
    expect(shouldApplyRemoteSdp(false, "offer")).toBe(true);
    expect(shouldApplyRemoteSdp(false, "answer")).toBe(false);
  });
});

describe("shouldBufferRemoteOffer", () => {
  it("holds the offer until the callee has accepted", () => {
    expect(shouldBufferRemoteOffer({
      isInitiator: false,
      acceptedByUs: false,
      signalingState: "stable",
    })).toBe(true);
    expect(shouldBufferRemoteOffer({
      isInitiator: false,
      acceptedByUs: true,
      mediaReady: true,
      signalingState: "stable",
    })).toBe(false);
    expect(shouldBufferRemoteOffer({
      isInitiator: false,
      acceptedByUs: true,
      mediaReady: false,
      signalingState: "stable",
    })).toBe(true);
    expect(shouldBufferRemoteOffer({
      isInitiator: true,
      acceptedByUs: false,
      signalingState: "stable",
    })).toBe(false);
  });
});

describe("shouldIgnoreNewStartCall", () => {
  it("ignores a second tap while the first outgoing call is still starting", () => {
    expect(shouldIgnoreNewStartCall({
      currentCallId: "a",
      ended: false,
      connectionState: null,
    })).toBe(true);
    expect(shouldIgnoreNewStartCall({
      currentCallId: "a",
      ended: false,
      connectionState: "connecting",
    })).toBe(true);
  });

  it("allows a new start after hangup or a dead peer", () => {
    expect(shouldIgnoreNewStartCall({
      currentCallId: null,
      ended: true,
      connectionState: null,
    })).toBe(false);
    expect(shouldIgnoreNewStartCall({
      currentCallId: "a",
      ended: false,
      connectionState: "failed",
    })).toBe(false);
  });
});

describe("shouldRejectConcurrentInvite", () => {
  it("rejects a second invite only while a live call is still up", () => {
    expect(shouldRejectConcurrentInvite({
      currentCallId: "a",
      incomingCallId: "b",
      ended: false,
      peerDead: false,
    })).toBe(true);
    expect(shouldRejectConcurrentInvite({
      currentCallId: "a",
      incomingCallId: "b",
      ended: true,
      peerDead: false,
    })).toBe(false);
    expect(shouldRejectConcurrentInvite({
      currentCallId: "a",
      incomingCallId: "b",
      ended: false,
      peerDead: true,
    })).toBe(false);
  });
});

describe("needsRecvOnlyVideoLine", () => {
  it("keeps a video m-line on audio calls so Safari can ICE-connect", () => {
    expect(needsRecvOnlyVideoLine("audio")).toBe(true);
    expect(needsRecvOnlyVideoLine(null)).toBe(true);
    expect(needsRecvOnlyVideoLine("video")).toBe(false);
  });
});

describe("addIncomingTrack", () => {
  it("keeps a track that arrives without streams[] (Safari)", () => {
    const tracks: { id: string }[] = [];
    const remote = {
      getTracks: () => tracks,
      addTrack: (t: { id: string }) => { tracks.push(t); },
    } as unknown as MediaStream;
    addIncomingTrack(remote, { track: { id: "v1", kind: "video" } as MediaStreamTrack, streams: [] });
    expect(tracks.map((t) => t.id)).toEqual(["v1"]);
  });
});
