import { useEffect, useRef, useState } from "react";
import { pickVoiceRecorderMime } from "./voiceNoteMime";

const MAX_MS = 60_000;

export function VoiceNoteRecorder({
  disabled,
  onSend,
  labels,
  buttonClassName = "btn",
}: {
  disabled?: boolean;
  onSend: (blob: Blob, durationMs: number) => void | Promise<void>;
  labels: {
    record: string;
    recording: (sec: number) => string;
    stop: string;
    cancel: string;
    failed: string;
  };
  buttonClassName?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);

  function cleanup() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (limitRef.current) window.clearTimeout(limitRef.current);
    tickRef.current = null;
    limitRef.current = null;
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }

  useEffect(() => () => cleanup(), []);

  async function start() {
    if (disabled || recording || sending) return;
    setError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(labels.failed);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = typeof MediaRecorder !== "undefined"
        ? pickVoiceRecorderMime((type) => MediaRecorder.isTypeSupported(type))
        : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      recRef.current = rec;
      startedAt.current = Date.now();
      setSec(0);
      setRecording(true);
      rec.start(250);
      tickRef.current = window.setInterval(() => {
        setSec(Math.round((Date.now() - startedAt.current) / 1000));
      }, 250);
      limitRef.current = window.setTimeout(() => { void stop(true); }, MAX_MS);
    } catch {
      cleanup();
      setError(labels.failed);
    }
  }

  async function stop(send: boolean) {
    const rec = recRef.current;
    const durationMs = Date.now() - startedAt.current;
    if (!rec) {
      cleanup();
      return;
    }
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      if (rec.state !== "inactive") rec.stop();
      else resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
    });
    cleanup();
    if (!send || blob.size < 200) return;
    setSending(true);
    try {
      await onSend(blob, durationMs);
    } catch {
      setError(labels.failed);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {recording ? (
        <>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{labels.recording(sec)}</span>
          <button type="button" className={buttonClassName} onClick={() => void stop(true)}>{labels.stop}</button>
          <button type="button" className={buttonClassName} onClick={() => void stop(false)}>{labels.cancel}</button>
        </>
      ) : (
        <button type="button" className={buttonClassName} disabled={disabled || sending} onClick={() => void start()}>
          {sending ? "…" : labels.record}
        </button>
      )}
      {error ? <span style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span> : null}
    </div>
  );
}
