import type { CallEvent, CallParty } from "../../types/types";

/** Frames we ourselves sent and the hub echoed back must not be applied. */
export function isSelfCallEcho(selfRole: CallParty, event: Pick<CallEvent, "from">): boolean {
  return event.from === selfRole;
}

/** Initiator creates the offer; only the callee should apply a remote offer, and vice versa. */
export function shouldApplyRemoteSdp(
  isInitiator: boolean,
  sdpType: "offer" | "answer",
): boolean {
  return sdpType === "offer" ? !isInitiator : isInitiator;
}

/** Callee must finish getUserMedia before applying the offer, or the answer has no send tracks. */
export function shouldBufferRemoteOffer(args: {
  isInitiator: boolean;
  acceptedByUs: boolean;
  mediaReady?: boolean;
  signalingState: string;
}): boolean {
  if (args.isInitiator) return false;
  if (!args.acceptedByUs || args.mediaReady === false) return true;
  return args.signalingState !== "stable" && args.signalingState !== "have-remote-offer";
}

/** iOS/Safari often fires ontrack with a track but an empty streams array. */
export function addIncomingTrack(
  remote: MediaStream,
  ev: { track?: MediaStreamTrack | null; streams?: readonly MediaStream[] },
): void {
  const fromStream = ev.streams?.[0];
  if (fromStream) {
    for (const t of fromStream.getTracks()) {
      if (!remote.getTracks().some((x) => x.id === t.id)) remote.addTrack(t);
    }
    return;
  }
  if (ev.track && !remote.getTracks().some((x) => x.id === ev.track!.id)) {
    remote.addTrack(ev.track);
  }
}

export function streamHasLiveVideo(stream: MediaStream | null | undefined): boolean {
  return !!stream?.getVideoTracks?.().some((t) => t.readyState !== "ended");
}

export function streamHasLiveAudio(stream: MediaStream | null | undefined): boolean {
  return !!stream?.getAudioTracks?.().some((t) => t.readyState !== "ended");
}

/** Safari audio-only PeerConnections often never ICE-connect without a video m-line. */
export function needsRecvOnlyVideoLine(mode: string | null | undefined): boolean {
  return mode !== "video";
}

/** A leftover callId after hangup/ICE-fail must not reject the next invite. */
/** Second tap while the first getUserMedia is still running must not tear the call down. */
export function shouldIgnoreNewStartCall(args: {
  currentCallId: string | null;
  ended: boolean;
  connectionState: string | null;
}): boolean {
  if (!args.currentCallId || args.ended) return false;
  return args.connectionState !== "failed" && args.connectionState !== "closed";
}

export function shouldRejectConcurrentInvite(args: {
  currentCallId: string | null;
  incomingCallId: string;
  ended: boolean;
  peerDead: boolean;
}): boolean {
  if (!args.currentCallId || args.currentCallId === args.incomingCallId) return false;
  if (args.ended || args.peerDead) return false;
  return true;
}
