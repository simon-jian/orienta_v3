/**
 * Shared chat-kind allowlist for the WebSocket hub and HTTP chat fallbacks.
 */
import type { ChatKind } from "../../src/types/types";

export const VALID_CHAT_KINDS = new Set<ChatKind>([
  "text",
  "location",
  "system",
  "ai_agent",
  "operator",
  "voice",
]);

export function normalizeChatKind(raw: unknown): ChatKind {
  return typeof raw === "string" && VALID_CHAT_KINDS.has(raw as ChatKind)
    ? (raw as ChatKind)
    : "text";
}
