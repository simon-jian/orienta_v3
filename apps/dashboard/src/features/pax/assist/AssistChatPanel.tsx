import { useEffect, useRef, useState } from "react";
import type { ChatMessage, MsgRecord } from "../../../types/types";
import { VoiceNoteBubble } from "../../media/VoiceNoteBubble";
import { VoiceNoteRecorder } from "../../media/VoiceNoteRecorder";
import { usePaxI18n, type PaxMessageKey } from "../i18n";
import { fmtAssistTime } from "./assistTypes";

function MessageList({
  messages,
  plan,
  voiceAuthHeaders,
}: {
  messages: ChatMessage[];
  plan: "free" | "premium";
  voiceAuthHeaders?: Record<string, string>;
}) {
  const { t, intlLocale } = usePaxI18n();
  if (!messages.length) {
    return (
      <div className="pax-assist-watermark">
        {t("chat.watermark")}
        <span>
          {plan === "premium" ? t("chat.watermarkPremium") : t("chat.watermarkFree")}
        </span>
      </div>
    );
  }
  return (
    <>
      {messages.map((m) => {
        const own = m.from === "pax";
        const role =
          m.from === "pax" ? "pax" : m.from === "system" ? "system" : m.from === "agent" ? "agent" : "admin";
        const roleKey = `chat.role.${role}` as PaxMessageKey;
        const fromLabel = own ? t("chat.you") : role === "pax" ? t("chat.you") : t(roleKey);
        return (
          <div key={m.id} className={`pax-assist-msg ${own ? "right" : "left"}`}>
            <div className="pax-assist-msg-meta">
              {fromLabel} · {fmtAssistTime(m.createdAt, intlLocale)}
            </div>
            <div className={`pax-assist-bubble ${role}`}>
              {m.kind === "voice" ? (
                <VoiceNoteBubble body={m.body} authHeaders={voiceAuthHeaders} playLabel={t("media.playVoice")} />
              ) : (
                m.body
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

type Props = {
  plan: "free" | "premium";
  canChat: boolean;
  canShareLocation: boolean;
  chat: ChatMessage[];
  notifications: MsgRecord[];
  unreadChat: boolean;
  locationStatus: string;
  voiceAuthHeaders?: Record<string, string>;
  onClearUnread: () => void;
  onSendChat: (body: string) => void;
  onShareLocation: () => void;
  onStartVideo?: () => void;
  onStartAudio?: () => void;
  onSendVoiceNote?: (blob: Blob, durationMs: number) => Promise<void>;
};

export function AssistChatPanel({
  plan,
  canChat,
  canShareLocation,
  chat,
  notifications,
  unreadChat,
  locationStatus,
  voiceAuthHeaders,
  onClearUnread,
  onSendChat,
  onShareLocation,
  onStartVideo,
  onStartAudio,
  onSendVoiceNote,
}: Props) {
  const t = usePaxI18n().t;
  const [input, setInput] = useState("");
  const [dismissedNotify, setDismissedNotify] = useState<Set<string>>(() => new Set());
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const visibleBanners = notifications.filter((n) => !dismissedNotify.has(n.messageId)).slice(0, 3);

  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat]);

  function focusChat() {
    onClearUnread();
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" });
  }

  function send() {
    const body = input.trim();
    if (!body || !canChat) return;
    onSendChat(body);
    setInput("");
  }

  return (
    <div className="pax-assist-chat">
      <div className="pax-assist-chat-head">
        <span>{t("chat.head")}</span>
        {unreadChat ? <span className="pax-assist-unread-dot" aria-label={t("chat.unread")} /> : null}
      </div>

      {visibleBanners.map((n) => (
        <div key={n.messageId} className="pax-assist-notify-banner">
          <button
            type="button"
            className="dismiss"
            aria-label={t("chat.dismiss")}
            onClick={() => setDismissedNotify((prev) => new Set(prev).add(n.messageId))}
          >
            ×
          </button>
          <b>{n.title}</b>
          <div>{n.body}</div>
        </div>
      ))}

      {unreadChat ? (
        <button type="button" className="pax-assist-chat-alert" onClick={focusChat}>
          <span className="pax-assist-chat-alert-dot" />
          <span>{t("chat.newMessage")}</span>
          <span className="pax-assist-chat-alert-action">{t("chat.viewMessage")}</span>
        </button>
      ) : null}

      <div className="pax-assist-msgs" ref={msgsRef} onScroll={onClearUnread}>
        <MessageList messages={chat} plan={plan} voiceAuthHeaders={voiceAuthHeaders} />
      </div>

      <div className="pax-assist-status-row">
        <span>{locationStatus}</span>
        <button type="button" className="pax-assist-loc-btn" disabled={!canShareLocation} onClick={onShareLocation}>
          {t("chat.shareLocation")}
        </button>
      </div>

      {canChat ? (
        <div className="pax-assist-input-area pax-assist-input-area--media">
          <div className="pax-assist-media-row">
            <button type="button" className="pax-assist-loc-btn" onClick={onStartVideo}>
              {t("media.video")}
            </button>
            <button type="button" className="pax-assist-loc-btn" onClick={onStartAudio}>
              {t("media.voice")}
            </button>
            {onSendVoiceNote ? (
              <VoiceNoteRecorder
                buttonClassName="pax-assist-loc-btn"
                onSend={onSendVoiceNote}
                labels={{
                  record: t("media.record"),
                  recording: (sec) => t("media.recording", { sec }),
                  stop: t("media.recordStop"),
                  cancel: t("media.recordCancel"),
                  failed: t("media.voiceNoteFailed"),
                }}
              />
            ) : null}
          </div>
          <div className="pax-assist-input-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={plan === "premium" ? t("chat.placeholderPremium") : t("chat.placeholderFree")}
            />
            <button type="button" className="pax-assist-send" disabled={!input.trim()} onClick={send}>
              {t("chat.send")}
            </button>
          </div>
        </div>
      ) : (
        <div className="pax-assist-input-area pax-assist-input-area--disabled">
          <div className="pax-assist-free-note">{t("chat.invalidSession")}</div>
        </div>
      )}
    </div>
  );
}
