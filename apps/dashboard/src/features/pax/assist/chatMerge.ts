import type { ChatMessage } from "../../../types/types";

/** Merge server/WS chat into local state without duplicating optimistic locals. */
export function upsertChatMessage(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === msg.id)) {
    return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
  }
  if (msg.from === "pax" || msg.from === "admin") {
    const idx = prev.findIndex(
      (m) =>
        m.id.startsWith("local_") &&
        m.from === msg.from &&
        m.body === msg.body &&
        Math.abs(m.createdAt - msg.createdAt) < 120_000,
    );
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = msg;
      return next.slice(-50);
    }
  }
  return [...prev, msg].slice(-50);
}

export function mergeChatHistory(prev: ChatMessage[], serverMsgs: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of serverMsgs) byId.set(m.id, m);
  for (const m of prev) {
    if (!m.id.startsWith("local_")) continue;
    const echoed = serverMsgs.some(
      (s) => s.from === m.from && s.body === m.body && Math.abs(s.createdAt - m.createdAt) < 120_000,
    );
    if (!echoed) byId.set(m.id, m);
  }
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-50);
}
