import { useEffect, useRef, useState } from "react";
import type { ChatMessage, MsgRecord } from "../../../types/types";
import { fmtAssistTime } from "./assistTypes";

function MessageList({
  messages,
  plan,
}: {
  messages: ChatMessage[];
  plan: "free" | "premium";
}) {
  if (!messages.length) {
    return (
      <div className="pax-assist-watermark">
        Air China 智能中转 · Orienta Transfer Assist
        <span>
          {plan === "premium"
            ? "Premium：可与运营助手对话。"
            : "Free：由 AI agent 协助。可收通知并分享位置。"}
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
        return (
          <div key={m.id} className={`pax-assist-msg ${own ? "right" : "left"}`}>
            <div className="pax-assist-msg-meta">
              {own ? "You" : m.from} · {fmtAssistTime(m.createdAt)}
            </div>
            <div className={`pax-assist-bubble ${role}`}>{m.body}</div>
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
  onClearUnread: () => void;
  onSendChat: (body: string) => void;
  onShareLocation: () => void;
};

export function AssistChatPanel({
  plan,
  canChat,
  canShareLocation,
  chat,
  notifications,
  unreadChat,
  locationStatus,
  onClearUnread,
  onSendChat,
  onShareLocation,
}: Props) {
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
        <span>与 Orienta Agent 交互</span>
        {unreadChat ? <span className="pax-assist-unread-dot" aria-label="unread" /> : null}
      </div>

      {visibleBanners.map((n) => (
        <div key={n.messageId} className="pax-assist-notify-banner">
          <button
            type="button"
            className="dismiss"
            aria-label="Dismiss"
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
          <span>客服新消息</span>
          <span className="pax-assist-chat-alert-action">查看消息</span>
        </button>
      ) : null}

      <div className="pax-assist-msgs" ref={msgsRef} onScroll={onClearUnread}>
        <MessageList messages={chat} plan={plan} />
      </div>

      <div className="pax-assist-status-row">
        <span>{locationStatus}</span>
        <button type="button" className="pax-assist-loc-btn" disabled={!canShareLocation} onClick={onShareLocation}>
          Share Location
        </button>
      </div>

      {canChat ? (
        <div className="pax-assist-input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={plan === "premium" ? "给运营助手发消息…" : "给 AI 助手发消息…"}
          />
          <button type="button" className="pax-assist-send" disabled={!input.trim()} onClick={send}>
            Send
          </button>
        </div>
      ) : (
        <div className="pax-assist-input-area pax-assist-input-area--disabled">
          <div className="pax-assist-free-note">会话无效，请重新登录旅客端。</div>
        </div>
      )}
    </div>
  );
}
