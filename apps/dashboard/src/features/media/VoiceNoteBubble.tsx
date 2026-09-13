import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../config/api";
import { formatCallClock, parseVoiceNoteBody } from "./voiceNoteBody";
import { typedAudioBlob } from "./voiceNoteMime";

export function VoiceNoteBubble({
  body,
  authHeaders,
  playLabel = "Play voice note",
}: {
  body: string;
  authHeaders?: Record<string, string>;
  playLabel?: string;
}) {
  const parsed = parseVoiceNoteBody(body);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!parsed) return;
    let objectUrl = "";
    let cancelled = false;
    setError(false);
    void fetch(apiUrl(`/api/voice-notes/${encodeURIComponent(parsed.id)}?playable=1`), {
      credentials: "same-origin",
      headers: authHeaders,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = typedAudioBlob(await res.blob(), res.headers.get("content-type"));
        return blob;
      })
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setError(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [parsed?.id, authHeaders?.Authorization]);

  async function play() {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (el.paused) {
        await el.play();
        setPlaying(true);
      } else {
        el.pause();
        setPlaying(false);
      }
    } catch {
      setError(true);
    }
  }

  if (!parsed) return <span>{body}</span>;
  if (error) return <span>Voice note unavailable</span>;
  if (!src) return <span>… {formatCallClock(parsed.durationSec * 1000)}</span>;

  return (
    <span style={{ display: "grid", gap: 6 }}>
      <audio
        ref={audioRef}
        controls
        src={src}
        preload="metadata"
        playsInline
        aria-label={playLabel}
        style={{ width: "min(220px, 100%)" }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
      <button
        type="button"
        onClick={() => void play()}
        style={{
          justifySelf: "start",
          border: 0,
          borderRadius: 999,
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: "#111827",
          color: "#fff",
        }}
      >
        {playing ? "Pause" : playLabel}
      </button>
      <span style={{ fontSize: 11, opacity: 0.75 }}>{formatCallClock(parsed.durationSec * 1000)}</span>
    </span>
  );
}
