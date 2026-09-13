import { useEffect, useRef, useState } from "react";
import { overlayErrorKind } from "./callSession";
import { streamHasLiveVideo } from "./callSignaling";
import type { PeerCallApi } from "./usePeerCall";
import { formatCallClock } from "./voiceNoteBody";
import "./callOverlay.css";

export type CallOverlayLabels = {
  incomingVideo: string;
  incomingAudio: string;
  outgoingVideo: string;
  outgoingAudio: string;
  connecting: string;
  inCall: string;
  accept: string;
  reject: string;
  hangup: string;
  mute: string;
  unmute: string;
  cameraOff: string;
  cameraOn: string;
  permissionDenied: string;
  permissionHint: string;
  permissionInsecure: string;
  permissionBlocked: string;
  permissionRetry: string;
  permissionUnavailable: string;
  permissionNotFound: string;
  waitingVideo: string;
  cameraNeeded: string;
  cameraBlank: string;
  cameraInUse: string;
  callFailed: string;
  callRejected: string;
  callTimeout: string;
};

function attachStream(el: HTMLMediaElement | null, stream: MediaStream | null, muted = false) {
  if (!el) return;
  el.muted = muted;
  if ("playsInline" in el) (el as HTMLVideoElement).playsInline = true;
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");
  el.setAttribute("autoplay", "");
  if (el.srcObject !== stream) el.srcObject = stream;
  const play = () => { void el.play().catch(() => { /* autoplay may wait */ }); };
  play();
  el.onloadedmetadata = play;
  el.oncanplay = play;
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.addEventListener("unmute", play);
  }
  requestAnimationFrame(play);
}

function permissionCopy(error: string | null, labels: CallOverlayLabels): string | null {
  if (error === "insecure") return labels.permissionInsecure;
  if (error === "unavailable") return labels.permissionUnavailable;
  if (error === "notfound") return labels.permissionNotFound;
  if (error === "denied" || error === "permission") return labels.permissionBlocked;
  return null;
}

export function CallOverlay({
  call,
  peerLabel,
  labels,
}: {
  call: PeerCallApi;
  peerLabel: string;
  labels: CallOverlayLabels;
}) {
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localRef = useRef<HTMLVideoElement | null>(null);
  const [localBlank, setLocalBlank] = useState(false);

  const compact =
    call.requestingMedia
    || call.phase === "incoming"
    || call.phase === "idle"
    || !!permissionCopy(call.error, labels);

  const bindRemote = (el: HTMLVideoElement | null) => {
    remoteRef.current = el;
    attachStream(el, call.remoteStream, false);
  };
  const bindRemoteAudio = (el: HTMLAudioElement | null) => {
    remoteAudioRef.current = el;
    attachStream(el, call.remoteStream, false);
  };
  const bindLocal = (el: HTMLVideoElement | null) => {
    localRef.current = el;
    attachStream(el, call.localStream, true);
  };

  useEffect(() => {
    attachStream(remoteRef.current, call.remoteStream, false);
    attachStream(remoteAudioRef.current, call.remoteStream, false);
  }, [call.remoteStream, compact, call.phase]);
  useEffect(() => {
    attachStream(localRef.current, call.localStream, true);
  }, [call.localStream, compact, call.phase]);
  useEffect(() => () => {
    attachStream(remoteRef.current, null, false);
    attachStream(remoteAudioRef.current, null, false);
    attachStream(localRef.current, null, true);
  }, []);

  useEffect(() => {
    if (!streamHasLiveVideo(call.localStream) || call.cameraOff) {
      setLocalBlank(false);
      return;
    }
    const started = Date.now();
    const tick = () => {
      const el = localRef.current;
      setLocalBlank(!!el && el.videoWidth === 0 && el.videoHeight === 0 && Date.now() - started >= 1800);
    };
    const id = window.setInterval(tick, 400);
    const once = window.setTimeout(tick, 1800);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(once);
    };
  }, [call.localStream, call.cameraOff, call.phase]);

  if (call.phase === "idle" && !call.error) return null;

  const incoming = call.phase === "incoming";
  const permissionText = permissionCopy(call.error, labels);
  const kind = overlayErrorKind(call.error);
  const errorText =
    permissionText
      || (kind === "camera" ? labels.cameraNeeded
        : kind === "inuse" ? labels.cameraInUse
        : kind === "rejected" ? labels.callRejected
        : kind === "timeout" ? labels.callTimeout
        : kind === "failed" ? labels.callFailed
          : null);
  const title = incoming
    ? (call.mode === "video" ? labels.incomingVideo : labels.incomingAudio)
    : call.phase === "outgoing"
      ? (call.mode === "video" ? labels.outgoingVideo : labels.outgoingAudio)
      : call.phase === "connecting"
        ? (call.requestingMedia ? labels.permissionHint : labels.connecting)
        : call.phase === "idle"
          ? (errorText || labels.callFailed)
          : labels.inCall;

  const localVideo = call.mode === "video" && streamHasLiveVideo(call.localStream);
  const remoteVideo = call.mode === "video" && streamHasLiveVideo(call.remoteStream);
  const showStage = call.mode === "video" || localVideo || remoteVideo;
  const initial = (peerLabel || "?").trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div
      className={`orienta-call-overlay${compact ? " is-compact" : ""}`}
      role="dialog"
      aria-label={title}
    >
      <div className="orienta-call-card">
        <div className={`orienta-call-stage${showStage ? "" : " is-audio"}`}>
          {!remoteVideo && !localVideo ? (
            <div className="orienta-call-avatar">{initial}</div>
          ) : null}
          {!remoteVideo && call.mode === "video" && (call.phase === "connecting" || call.phase === "in_call") ? (
            <div className="orienta-call-waiting">{labels.waitingVideo}</div>
          ) : null}
          <video
            ref={bindRemote}
            className={`orienta-call-remote${remoteVideo ? "" : " is-audio"}`}
            autoPlay
            playsInline
          />
          <audio ref={bindRemoteAudio} className="orienta-call-remote-audio" autoPlay playsInline />
          {localVideo ? (
            <div className={remoteVideo ? "orienta-call-local-wrap" : undefined}>
              <video
                key={call.localStream?.id ?? "local"}
                ref={bindLocal}
                className={remoteVideo ? "orienta-call-local" : "orienta-call-remote is-self"}
                autoPlay
                playsInline
                muted
              />
              {remoteVideo ? <span className="orienta-call-local-tag">本机</span> : null}
            </div>
          ) : null}
        </div>
        <div className="orienta-call-meta">
          <div className="orienta-call-title">{title}</div>
          <div className="orienta-call-sub">
            {peerLabel}
            {call.phase === "in_call" ? ` · ${formatCallClock(call.elapsedMs)}` : ""}
          </div>
        </div>
        {call.requestingMedia ? (
          <div className="orienta-call-hint">{labels.permissionHint}</div>
        ) : null}
        {errorText && !call.requestingMedia ? (
          <div className={call.error === "camera" || call.error === "inuse" ? "orienta-call-hint" : "orienta-call-error"}>{errorText}</div>
        ) : null}
        {localBlank && !errorText && !call.requestingMedia ? (
          <div className="orienta-call-hint">{labels.cameraBlank}</div>
        ) : null}
        <div className="orienta-call-actions">
          {call.phase === "idle" ? (
            <button type="button" className="orienta-call-btn hangup" onClick={call.hangup}>
              {labels.hangup}
            </button>
          ) : incoming ? (
            <>
              <button
                type="button"
                className="orienta-call-btn accept"
                onClick={() => {
                  call.primeLocalMedia(call.mode === "audio" ? "audio" : "video");
                  void call.accept();
                }}
              >
                {permissionText ? labels.permissionRetry : labels.accept}
              </button>
              <button type="button" className="orienta-call-btn reject" onClick={call.reject}>
                {labels.reject}
              </button>
            </>
          ) : call.requestingMedia ? (
            <>
              {call.mode === "video" ? (
                <button type="button" className="orienta-call-btn accept" onClick={call.toggleCamera}>
                  {labels.cameraOn}
                </button>
              ) : null}
              <button type="button" className="orienta-call-btn hangup" onClick={call.hangup}>
                {labels.hangup}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="orienta-call-btn" onClick={call.toggleMute}>
                {call.muted ? labels.unmute : labels.mute}
              </button>
              {call.mode === "video" || localVideo ? (
                <button type="button" className="orienta-call-btn accept" onClick={call.toggleCamera}>
                  {localVideo && !call.cameraOff ? labels.cameraOff : labels.cameraOn}
                </button>
              ) : null}
              <button type="button" className="orienta-call-btn hangup" onClick={call.hangup}>
                {labels.hangup}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function adminCallLabels(): CallOverlayLabels {
  return {
    incomingVideo: "来电视频 Incoming video",
    incomingAudio: "来电语音 Incoming voice",
    outgoingVideo: "正在视频呼叫 Calling…",
    outgoingAudio: "正在语音呼叫 Calling…",
    connecting: "接通中 Connecting…",
    inCall: "通话中 In call",
    accept: "接听 Accept",
    reject: "拒绝 Decline",
    hangup: "挂断 Hang up",
    mute: "静音 Mute",
    unmute: "取消静音 Unmute",
    cameraOff: "关摄像头 Cam off",
    cameraOn: "开摄像头 Cam on",
    permissionDenied: "需要麦克风/摄像头权限",
    permissionHint: "请看浏览器窗口最上方，点「允许」。浮层已让开，不会挡住授权框。",
    permissionInsecure: "当前地址不是 https 或 localhost，浏览器不会弹出授权。请用 http://localhost:5173 或 https 打开后台后再接听。",
    permissionBlocked: "浏览器已拦截麦克风/摄像头。请点地址栏左侧锁头 → 网站设置 → 将麦克风和摄像头设为「允许」，然后点「允许并重试」。",
    permissionRetry: "允许并重试 Allow again",
    permissionUnavailable: "这个浏览器无法使用麦克风或摄像头。请换用 Chrome / Edge。",
    permissionNotFound: "没有找到麦克风。请检查设备后点「允许并重试」。",
    waitingVideo: "等待对方画面 Waiting for their camera",
    cameraNeeded: "本机摄像头没打开。请点「开摄像头」，并在地址栏允许相机（麦克风允许不够）。",
    cameraInUse: "摄像头还在关闭中。请再点一次「视频」。",
    cameraBlank: "这台电脑的摄像头已允许，但没有画面（地址栏预览也是黑的）。请拉开笔记本镜头盖 / 打开隐私开关，再用系统相机应用试一下。桌面没有摄像头没关系，用笔记本打开这个后台即可。",
    callFailed: "无法建立媒体连接。请双方强制刷新后再试；若旅客在手机流量上，可能需要等几秒走中继。",
    callRejected: "对方忙线或未接听。请挂断后再拨一次。",
    callTimeout: "无人接听。请稍后再拨。",
  };
}
