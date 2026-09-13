import { useCallback, useEffect, useRef, useState } from "react";
import type { CallEvent, CallMode, CallParty } from "../../types/types";
import { incomingInviteAction, type CallPhase } from "./callSession";
import { addIncomingTrack, isSelfCallEcho, needsRecvOnlyVideoLine, shouldApplyRemoteSdp, shouldBufferRemoteOffer, shouldIgnoreNewStartCall } from "./callSignaling";
import { loadIceServers } from "./iceServers";
import { acquireErrorCode, acquireLocalStream, acquireVideoTrack, detachCallMediaElements } from "./localMedia";

export type { CallPhase };

export type PeerCallState = {
  phase: CallPhase;
  mode: CallMode | null;
  passengerId: string | null;
  callId: string | null;
  muted: boolean;
  cameraOff: boolean;
  error: string | null;
  elapsedMs: number;
  requestingMedia: boolean;
};

const RING_TIMEOUT_MS = 45_000;

type SendFn = (passengerId: string, event: Omit<CallEvent, "passengerId">) => void;

function newCallId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* ignore */ }
  }
}

export function usePeerCall(opts: {
  selfRole: CallParty;
  send: SendFn;
}) {
  const sendRef = useRef(opts.send);
  sendRef.current = opts.send;
  const selfRole = opts.selfRole;

  const emit = (passengerId: string, event: Omit<CallEvent, "passengerId" | "from">) => {
    sendRef.current(passengerId, { ...event, from: selfRole });
  };

  const [state, setState] = useState<PeerCallState>({
    phase: "idle",
    mode: null,
    passengerId: null,
    callId: null,
    muted: false,
    cameraOff: false,
    error: null,
    elapsedMs: 0,
    requestingMedia: false,
  });
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const pendingRemoteIce = useRef<RTCIceCandidateInit[]>([]);
  const pendingRemoteSdp = useRef<{ type: "offer" | "answer"; sdp: string } | null>(null);
  const remoteReady = useRef(false);
  const acceptedByUs = useRef(false);
  const isInitiator = useRef(false);
  const iceRestarted = useRef(false);
  const mediaReady = useRef(false);
  const primedMedia = useRef<ReturnType<typeof acquireLocalStream> | null>(null);
  const sendClones = useRef<MediaStreamTrack[]>([]);
  const opChain = useRef(Promise.resolve());
  const connectedAt = useRef<number | null>(null);
  const didConnect = useRef(false);
  const ringTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const passengerIdRef = useRef<string | null>(null);
  const modeRef = useRef<CallMode | null>(null);
  const endedRef = useRef(false);
  const phaseRef = useRef<CallPhase>("idle");

  const clearTimers = () => {
    if (ringTimer.current) {
      window.clearTimeout(ringTimer.current);
      ringTimer.current = null;
    }
    if (tickTimer.current) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  };

  const stopSendClones = () => {
    for (const track of sendClones.current) {
      try { track.stop(); } catch { /* ignore */ }
    }
    sendClones.current = [];
  };

  const teardownMedia = useCallback(() => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
      } catch { /* ignore */ }
      try { pc.close(); } catch { /* ignore */ }
    }
    detachCallMediaElements();
    stopSendClones();
    stopStream(localRef.current);
    localRef.current = null;
    remoteRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    pendingRemoteIce.current = [];
    pendingRemoteSdp.current = null;
    remoteReady.current = false;
  }, []);

  const resetIdle = useCallback((error: string | null = null) => {
    clearTimers();
    teardownMedia();
    acceptedByUs.current = false;
    isInitiator.current = false;
    connectedAt.current = null;
    didConnect.current = false;
    iceRestarted.current = false;
    mediaReady.current = false;
    primedMedia.current = null;
    callIdRef.current = null;
    passengerIdRef.current = null;
    modeRef.current = null;
    endedRef.current = true;
    phaseRef.current = "idle";
    setState({
      phase: "idle",
      mode: null,
      passengerId: null,
      callId: null,
      muted: false,
      cameraOff: false,
      error,
      elapsedMs: 0,
      requestingMedia: false,
    });
  }, [teardownMedia]);

  const startTicker = () => {
    if (tickTimer.current) window.clearInterval(tickTimer.current);
    tickTimer.current = window.setInterval(() => {
      const started = connectedAt.current;
      if (!started) return;
      setState((s) => ({ ...s, elapsedMs: Date.now() - started }));
    }, 500);
  };

  const runExclusive = (fn: () => Promise<void>) => {
    const next = opChain.current.then(fn, fn);
    opChain.current = next.catch(() => undefined);
    return next;
  };

  const applyRemoteIce = async (pc: RTCPeerConnection) => {
    const queued = pendingRemoteIce.current;
    pendingRemoteIce.current = [];
    for (const c of queued) {
      try { await pc.addIceCandidate(c); } catch { /* ignore stale */ }
    }
  };

  const applyRemoteSdp = async (pc: RTCPeerConnection, sdp: { type: "offer" | "answer"; sdp: string }) => {
    if (!shouldApplyRemoteSdp(isInitiator.current, sdp.type)) return;
    if (
      sdp.type === "offer" &&
      shouldBufferRemoteOffer({
        isInitiator: isInitiator.current,
        acceptedByUs: acceptedByUs.current,
        mediaReady: mediaReady.current,
        signalingState: pc.signalingState,
      })
    ) {
      pendingRemoteSdp.current = sdp;
      return;
    }
    if (sdp.type === "answer" && pc.signalingState !== "have-local-offer") {
      pendingRemoteSdp.current = sdp;
      return;
    }
    await pc.setRemoteDescription({ type: sdp.type, sdp: sdp.sdp });
    remoteReady.current = true;
    await applyRemoteIce(pc);
    if (sdp.type !== "offer") return;
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp && callIdRef.current && passengerIdRef.current) {
      emit(passengerIdRef.current, {
        type: "call_signal",
        callId: callIdRef.current,
        sdp: { type: "answer", sdp: answer.sdp },
      });
    }
    setState((s) => ({ ...s, phase: s.phase === "idle" ? s.phase : "connecting" }));
  };

  const flushPendingSdp = async () => {
    const pending = pendingRemoteSdp.current;
    if (!pending) return;
    pendingRemoteSdp.current = null;
    const pc = await ensurePc();
    await applyRemoteSdp(pc, pending);
  };

  const ensurePc = async (forCallId?: string | null): Promise<RTCPeerConnection> => {
    const want = forCallId ?? callIdRef.current;
    if (want && callIdRef.current !== want) throw new Error("stale_call");
    if (pcRef.current) return pcRef.current;
    const iceServers = await loadIceServers();
    if (want && callIdRef.current !== want) throw new Error("stale_call");
    if (pcRef.current) return pcRef.current;
    // iceCandidatePoolSize>0 predates transceivers and breaks the second
    // PeerConnection on WebKit (first video works, later voice/video fail).
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 0 });
    const remote = new MediaStream();
    remoteRef.current = remote;
    setRemoteStream(remote);
    pc.ontrack = (ev) => {
      addIncomingTrack(remote, ev);
      remoteRef.current = remote;
      setRemoteStream(new MediaStream(remote.getTracks()));
    };
    pc.onicecandidate = (ev) => {
      if (pcRef.current !== pc) return;
      if (!ev.candidate || !callIdRef.current || !passengerIdRef.current) return;
      const c = ev.candidate.toJSON();
      emit(passengerIdRef.current, {
        type: "call_signal",
        callId: callIdRef.current,
        candidate: {
          candidate: c.candidate || "",
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
        },
      });
    };
    const markConnected = () => {
      if (pcRef.current !== pc) return;
      didConnect.current = true;
      if (!connectedAt.current) connectedAt.current = Date.now();
      startTicker();
      phaseRef.current = "in_call";
      setState((s) => (s.phase === "in_call" ? s : { ...s, phase: "in_call", error: null }));
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const st = pc.connectionState;
      if (st === "connected") markConnected();
      if (st === "failed") {
        if (!didConnect.current && !iceRestarted.current && isInitiator.current && pcRef.current === pc) {
          iceRestarted.current = true;
          void (async () => {
            try {
              const cur = pcRef.current;
              if (!cur || cur !== pc || !callIdRef.current || !passengerIdRef.current) return;
              const offer = await cur.createOffer({ iceRestart: true });
              await cur.setLocalDescription(offer);
              if (offer.sdp && pcRef.current === pc) {
                emit(passengerIdRef.current, {
                  type: "call_signal",
                  callId: callIdRef.current,
                  sdp: { type: "offer", sdp: offer.sdp },
                });
              }
            } catch {
              if (pcRef.current === pc) void hangupInternal("failed");
            }
          })();
          return;
        }
        if (pcRef.current === pc) void hangupInternal("failed");
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const ice = pc.iceConnectionState;
      if (ice === "connected" || ice === "completed") markConnected();
    };
    if (want && callIdRef.current !== want) {
      try { pc.close(); } catch { /* ignore */ }
      throw new Error("stale_call");
    }
    pcRef.current = pc;
    return pc;
  };

  const ensureCallTransceivers = (pc: RTCPeerConnection) => {
    const hasAudio = pc.getTransceivers().some((t) => (
      t.sender.track?.kind === "audio" || t.receiver.track?.kind === "audio"
    ));
    if (!hasAudio) pc.addTransceiver("audio", { direction: "sendrecv" });
    const hasVideo = pc.getTransceivers().some((t) => (
      t.sender.track?.kind === "video" || t.receiver.track?.kind === "video"
    ));
    if (!hasVideo) {
      pc.addTransceiver("video", {
        direction: needsRecvOnlyVideoLine(modeRef.current) ? "recvonly" : "sendrecv",
      });
    }
  };

  const publishPreviewAndSend = (pc: RTCPeerConnection, stream: MediaStream) => {
    stopSendClones();
    const sendVideo = modeRef.current === "video";
    // Clone the camera track for the PeerConnection. Using the same track for
    // preview + send makes the local <video> go black on Chrome/Linux.
    for (const track of stream.getTracks()) {
      if (track.kind === "video") {
        if (!sendVideo) {
          try { track.stop(); } catch { /* ignore */ }
          try { stream.removeTrack(track); } catch { /* ignore */ }
          continue;
        }
        const send = track.clone();
        send.enabled = track.enabled;
        sendClones.current.push(send);
        pc.addTrack(send, stream);
      } else {
        pc.addTrack(track, stream);
      }
    }
  };

  const primeLocalMedia = useCallback((mode: CallMode) => {
    if (!primedMedia.current) {
      primedMedia.current = acquireLocalStream(mode).catch((err) => {
        primedMedia.current = null;
        throw err;
      });
    }
    return primedMedia.current;
  }, []);

  const acquireForCall = async (mode: CallMode) => {
    try {
      return await (primedMedia.current ?? acquireLocalStream(mode));
    } catch (err) {
      primedMedia.current = null;
      const code = acquireErrorCode(err);
      if (code !== "inuse" && code !== "failed") throw err;
      detachCallMediaElements();
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return await acquireLocalStream(mode);
    }
  };

  const attachLocal = async (mode: CallMode): Promise<CallMode> => {
    const got = await acquireForCall(mode);
    primedMedia.current = null;
    if (mode !== "video") {
      for (const track of got.stream.getVideoTracks()) {
        try { track.stop(); } catch { /* ignore */ }
        try { got.stream.removeTrack(track); } catch { /* ignore */ }
      }
    }
    for (const track of got.stream.getTracks()) {
      try { track.enabled = true; } catch { /* ignore */ }
    }
    stopStream(localRef.current);
    localRef.current = got.stream;
    setLocalStream(got.stream);
    const resolved: CallMode = mode === "video" ? "video" : got.mode;
    modeRef.current = resolved;
    const hasCam = !!got.stream.getVideoTracks?.().length;
    setState((s) => ({
      ...s,
      mode: resolved,
      cameraOff: resolved === "video" && !hasCam,
      error: got.cameraMissing ? "camera" : s.error,
    }));
    const pc = await ensurePc();
    publishPreviewAndSend(pc, got.stream);
    ensureCallTransceivers(pc);
    mediaReady.current = true;
    return resolved;
  };

  const enableCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({ ...s, error: "camera", cameraOff: true }));
      return;
    }
    const track = await acquireVideoTrack(
      navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    );
    if (!track) {
      setState((s) => ({ ...s, error: "camera", cameraOff: true }));
      return;
    }
    const local = localRef.current ?? new MediaStream();
    if (!local.getVideoTracks().some((t) => t.id === track.id)) local.addTrack(track);
    localRef.current = local;
    setLocalStream(new MediaStream(local.getTracks()));
    const pc = await ensurePc();
    const videoSender =
      pc.getSenders().find((s) => s.track?.kind === "video")
      ?? pc.getTransceivers().find((t) => t.receiver.track?.kind === "video")?.sender;
    const send = track.clone();
    send.enabled = true;
    stopSendClones();
    sendClones.current = [send];
    if (videoSender) {
      await videoSender.replaceTrack(send);
    } else {
      pc.addTrack(send, local);
      if (pc.signalingState === "stable" && callIdRef.current && passengerIdRef.current) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (offer.sdp) {
          emit(passengerIdRef.current, {
            type: "call_signal",
            callId: callIdRef.current,
            sdp: { type: "offer", sdp: offer.sdp },
          });
        }
      }
    }
    modeRef.current = "video";
    setState((s) => ({
      ...s,
      mode: "video",
      cameraOff: false,
      error: s.error === "camera" ? null : s.error,
    }));
  };

  const createOffer = async () => {
    const pc = await ensurePc();
    ensureCallTransceivers(pc);
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    if (!callIdRef.current || !passengerIdRef.current || !offer.sdp) return;
    emit(passengerIdRef.current, {
      type: "call_signal",
      callId: callIdRef.current,
      sdp: { type: "offer", sdp: offer.sdp },
    });
  };

  async function hangupInternal(reason: "local" | "remote" | "failed" | "timeout" | "reject") {
    const pid = passengerIdRef.current;
    const callId = callIdRef.current;
    const already = endedRef.current;
    if (reason === "local" && pid && callId && !already) {
      emit(pid, { type: "call_hangup", callId });
    }
    const error =
      reason === "failed" ? "failed"
        : reason === "timeout" ? "timeout"
          : reason === "reject" ? "rejected"
            : null;
    resetIdle(error);
  }

  const startCall = useCallback(async (passengerId: string, mode: CallMode) => {
    const pid = passengerId.trim();
    if (!pid) return;
    if (shouldIgnoreNewStartCall({
      currentCallId: callIdRef.current,
      ended: endedRef.current,
      connectionState: pcRef.current?.connectionState ?? null,
    })) {
      return;
    }
    // Keep getUserMedia on the tap so iOS still treats it as a user gesture.
    primeLocalMedia(mode);
    const callId = newCallId();
    await runExclusive(async () => {
      if (shouldIgnoreNewStartCall({
        currentCallId: callIdRef.current,
        ended: endedRef.current,
        connectionState: pcRef.current?.connectionState ?? null,
      })) {
        return;
      }
      teardownMedia();
      endedRef.current = false;
      callIdRef.current = callId;
      passengerIdRef.current = pid;
      modeRef.current = mode;
      isInitiator.current = true;
      acceptedByUs.current = false;
      phaseRef.current = "outgoing";
      setState({
        phase: "outgoing",
        mode,
        passengerId: pid,
        callId,
        muted: false,
        cameraOff: mode !== "video",
        error: null,
        elapsedMs: 0,
        requestingMedia: true,
      });
      try {
        await attachLocal(mode);
        if (callIdRef.current !== callId) return;
        setState((s) => ({ ...s, requestingMedia: false }));
      } catch (err) {
        if (callIdRef.current !== callId) return;
        emit(pid, { type: "call_hangup", callId });
        resetIdle(acquireErrorCode(err));
        return;
      }
      if (callIdRef.current !== callId) return;
      emit(pid, { type: "call_invite", callId, mode });
      ringTimer.current = window.setTimeout(() => { void hangupInternal("timeout"); }, RING_TIMEOUT_MS);
    });
  }, [primeLocalMedia, resetIdle, teardownMedia, selfRole]);

  const accept = useCallback(async () => {
    const pid = passengerIdRef.current;
    const callId = callIdRef.current;
    const mode = modeRef.current;
    if (!pid || !callId || !mode) return;
    isInitiator.current = false;
    // Start getUserMedia in this click turn so Chrome still treats it as a
    // user gesture. Waiting on the signaling queue first made laptops skip video.
    primeLocalMedia(mode);
    phaseRef.current = "connecting";
    setState((s) => ({ ...s, phase: "connecting", error: null, requestingMedia: true }));
    await runExclusive(async () => {
      try {
        await attachLocal(mode);
        acceptedByUs.current = true;
        setState((s) => ({ ...s, requestingMedia: false }));
      } catch (err) {
        acceptedByUs.current = false;
        mediaReady.current = false;
        setState((s) => ({
          ...s,
          phase: "incoming",
          error: acquireErrorCode(err),
          requestingMedia: false,
        }));
        return;
      }
      emit(pid, { type: "call_accept", callId });
      clearTimers();
      try {
        await flushPendingSdp();
      } catch {
        setState((s) => (s.phase === "idle" ? s : { ...s, error: "failed" }));
      }
    });
  }, [primeLocalMedia]);

  const reject = useCallback(() => {
    const pid = passengerIdRef.current;
    const callId = callIdRef.current;
    if (pid && callId) emit(pid, { type: "call_reject", callId });
    resetIdle(null);
  }, [resetIdle]);

  const hangup = useCallback(() => {
    void hangupInternal("local");
  }, []);

  const toggleMute = useCallback(() => {
    const next = !state.muted;
    localRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setState((s) => ({ ...s, muted: next }));
  }, [state.muted]);

  const toggleCamera = useCallback(() => {
    const videos = localRef.current?.getVideoTracks() ?? [];
    if (!videos.length) {
      void enableCamera();
      return;
    }
    const next = !state.cameraOff;
    videos.forEach((t) => { t.enabled = !next; });
    sendClones.current.forEach((t) => { t.enabled = !next; });
    pcRef.current?.getSenders().forEach((s) => {
      if (s.track?.kind === "video") s.track.enabled = !next;
    });
    setState((s) => ({ ...s, cameraOff: next, error: next ? s.error : (s.error === "camera" ? null : s.error) }));
  }, [state.cameraOff]);

  const handleEvent = useCallback(async (event: CallEvent) => {
    if (!event?.callId || !event.passengerId) return;
    if (isSelfCallEcho(selfRole, event)) return;

    if (event.type === "call_invite") {
      const action = incomingInviteAction({
        currentCallId: callIdRef.current,
        incomingCallId: event.callId,
        currentPassengerId: passengerIdRef.current,
        incomingPassengerId: event.passengerId,
        ended: endedRef.current,
        phase: phaseRef.current,
      });
      if (action === "ignore") return;
      if (action === "reject") {
        emit(event.passengerId, { type: "call_reject", callId: event.callId });
        return;
      }
      if (action === "replace") {
        clearTimers();
        teardownMedia();
      }
      endedRef.current = false;
      callIdRef.current = event.callId;
      passengerIdRef.current = event.passengerId;
      modeRef.current = event.mode === "video" ? "video" : "audio";
      isInitiator.current = false;
      acceptedByUs.current = false;
      mediaReady.current = false;
      primedMedia.current = null;
      iceRestarted.current = false;
      pendingRemoteSdp.current = null;
      phaseRef.current = "incoming";
      setState({
        phase: "incoming",
        mode: modeRef.current,
        passengerId: event.passengerId,
        callId: event.callId,
        muted: false,
        cameraOff: modeRef.current !== "video",
        error: null,
        elapsedMs: 0,
        requestingMedia: false,
      });
      ringTimer.current = window.setTimeout(() => { void hangupInternal("timeout"); }, RING_TIMEOUT_MS);
      return;
    }

    if (!callIdRef.current || event.callId !== callIdRef.current) {
      if (event.type === "call_accept" && event.passengerId === passengerIdRef.current) return;
      return;
    }

    if (event.type === "call_reject") {
      resetIdle("rejected");
      return;
    }

    if (event.type === "call_hangup") {
      resetIdle(null);
      return;
    }

    if (event.type === "call_accept") {
      if (!isInitiator.current) {
        if (!acceptedByUs.current) resetIdle(null);
        return;
      }
      clearTimers();
      phaseRef.current = "connecting";
      setState((s) => ({ ...s, phase: "connecting" }));
      const acceptedCallId = event.callId;
      await runExclusive(async () => {
        if (callIdRef.current !== acceptedCallId) return;
        try {
          await createOffer();
          if (callIdRef.current !== acceptedCallId) return;
          await flushPendingSdp();
        } catch (err) {
          if (err instanceof Error && err.message === "stale_call") return;
          if (callIdRef.current === acceptedCallId) void hangupInternal("failed");
        }
      });
      return;
    }

    if (event.type === "call_signal") {
      const signalCallId = event.callId;
      await runExclusive(async () => {
        if (callIdRef.current !== signalCallId) return;
        try {
          const pc = await ensurePc(signalCallId);
          if (callIdRef.current !== signalCallId) return;
          if (event.sdp) await applyRemoteSdp(pc, event.sdp);
          if (event.candidate) {
            const init: RTCIceCandidateInit = {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid ?? undefined,
              sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
            };
            if (remoteReady.current) {
              try { await pc.addIceCandidate(init); } catch { /* ignore */ }
            } else {
              pendingRemoteIce.current.push(init);
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message === "stale_call") return;
          if (event.sdp) setState((s) => (s.phase === "idle" ? s : { ...s, error: "failed" }));
        }
      });
    }
  }, [resetIdle, teardownMedia, selfRole]);

  useEffect(() => () => {
    clearTimers();
    teardownMedia();
  }, [teardownMedia]);

  return {
    ...state,
    localStream,
    remoteStream,
    startCall,
    primeLocalMedia,
    accept,
    reject,
    hangup,
    toggleMute,
    toggleCamera,
    handleEvent,
    connected: didConnect.current || state.phase === "in_call",
  };
}

export type PeerCallApi = ReturnType<typeof usePeerCall>;
