/**
 * Chat sub-module — message routing, AI agent replies.
 *
 * Extracted from the monolithic wsHub.ts.
 */
import crypto from "node:crypto";
import type { ChatMessage, ChatKind } from "../../src/types/types";
import { HubStore } from "./HubStore";
import { PEK_PREMIUM_IDS } from "../../src/data/airports/pek";

const AI_REPLY_DELAY_MS = 800;

/** Rules-based AI reply for free-tier passengers. */
function aiAgentReply(_passengerId: string, body: string, _history: ChatMessage[]): string {
  const lc = body.toLowerCase();
  if (/where|where am|位置|在哪|怎么走|how do i get|navigate|导航/.test(lc)) {
    return "Hi! I'm Orienta AI. To reach your gate, follow the signs to Transfer Security (Level 2). Your route has been updated on your map. Need more help? Type your question.";
  }
  if (/late|miss|赶不上|误机|delay|delayed/.test(lc)) {
    return "I can see your flight status. Please proceed directly to your gate now — do not stop. If you need staff assistance, contact the nearest Orienta counter.";
  }
  if (/security|安检|customs|海关/.test(lc)) {
    return "For I→I transfers at T3E, you need to go through Transfer Security on Level 3 first, then proceed down to Level 2 for your departure gate.";
  }
  if (/wheelchair|轮椅|accessible|无障碍/.test(lc)) {
    return "Accessibility assistance is available. Please proceed to the nearest staff counter or reply “help” to alert ground staff.";
  }
  if (/human|人工|staff|real person|operator/.test(lc)) {
    return "I understand you'd like to speak with a human agent. This service is available for Premium members. Please contact the nearest Orienta counter for in-person assistance.";
  }
  return "Thanks for your message. I'm Orienta AI assistant. Please proceed to your departure gate. Your real-time navigation is active on your screen. Reply with any questions!";
}

function isPremium(store: HubStore, tenantId: string, passengerId: string): boolean {
  const meta = store.paxMeta.get(HubStore.key(tenantId, passengerId));
  if (meta?.plan) return meta.plan === "premium";
  return PEK_PREMIUM_IDS.has(passengerId);
}

/**
 * Handle an outbound chat message from a pax (via WS or HTTP).
 * Stores it, broadcasts it, and triggers an AI reply for free-tier users.
 */
export function handlePaxOutboundChat(
  store: HubStore,
  tenantId: string,
  rawPassengerId: string,
  body: string,
  kind: ChatKind = "text",
  gateRef?: string
): ChatMessage | null {
  const pid = String(rawPassengerId ?? "").trim();
  if (!tenantId || !pid || !body) return null;

  const chatMsg: ChatMessage = {
    id: crypto.randomUUID(),
    passengerId: pid,
    tenantId,
    from: "pax",
    kind,
    body,
    gateRef,
    createdAt: Date.now(),
  };

  store.appendChat(tenantId, pid, chatMsg);
  store.broadcastAdmins(tenantId, { type: "chat_msg", message: chatMsg });
  store.broadcastPax(tenantId, pid, { type: "chat_msg", message: chatMsg });

  if (!isPremium(store, tenantId, pid)) {
    const hist = store.getChatHistory(tenantId, pid);
    const aiBody = aiAgentReply(pid, body, hist);
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        passengerId: pid,
        tenantId,
        from: "agent",
        kind: "ai_agent",
        body: aiBody,
        createdAt: Date.now(),
      };
      store.appendChat(tenantId, pid, aiMsg);
      store.broadcastAdmins(tenantId, { type: "chat_msg", message: aiMsg });
      store.broadcastPax(tenantId, pid, { type: "chat_msg", message: aiMsg });
    }, AI_REPLY_DELAY_MS);
  }

  return chatMsg;
}
