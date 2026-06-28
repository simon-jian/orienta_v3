/**
 * HubStore — shared in-memory state for the WebSocket hub.
 *
 * Fixes issue H6: module-level null singletons in wsHub.ts that made
 * the hub impossible to unit-test and caused silent double-registration bugs.
 *
 * Solution: inject one HubStore instance into both attachWsHub() and
 * registerApiRoutes(), so both sides share state without module coupling.
 */
import { WebSocket } from "ws";
import type { ChatMessage, MsgRecord } from "../../src/types/types";
import type { ChatRepository } from "./ChatRepository";
import { logger } from "../lib/logger";

const MAX_CHAT_HISTORY = 100;

export type PaxMeta = { displayName?: string; plan?: string };
export type TrajectoryData = {
  path: { lat: number; lng: number }[];
  position: { lat: number; lng: number };
};

export class HubStore {
  constructor(private readonly chatRepo?: ChatRepository) {}

  /** keyed by `tenantId::passengerId` → set of open WebSocket connections */
  readonly paxSockets = new Map<string, Set<WebSocket>>();
  /** keyed by tenantId → set of admin WebSocket connections */
  readonly adminSockets = new Map<string, Set<WebSocket>>();
  /** keyed by `tenantId::passengerId` — presence set */
  readonly online = new Set<string>();
  /** Grace-period timers before marking a pax offline after disconnect */
  readonly paxOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** One-way push messages (admin → pax, require ack) */
  readonly messages = new Map<string, MsgRecord>();
  /** Chat histories: keyed by `tenantId::passengerId` */
  readonly chatHistories = new Map<string, ChatMessage[]>();
  /** Optional pax display-name / plan override: keyed by `tenantId::passengerId` */
  readonly paxMeta = new Map<string, PaxMeta>();
  /** Live PDR trajectories: keyed by `tenantId::passengerId` */
  readonly paxTrajectories = new Map<string, TrajectoryData>();

  // ── Keys ────────────────────────────────────────────────────────────────────

  static key(tenantId: string, passengerId: string): string {
    return `${tenantId}::${passengerId}`;
  }

  // ── Online set ──────────────────────────────────────────────────────────────

  isOnline(tenantId: string, passengerId: string): boolean {
    return this.online.has(HubStore.key(tenantId, passengerId));
  }

  listOnline(tenantId: string): string[] {
    const prefix = `${tenantId}::`;
    const out: string[] = [];
    for (const key of this.online) {
      if (key.startsWith(prefix)) {
        const pid = key.slice(prefix.length);
        if (pid) out.push(pid);
      }
    }
    return out;
  }

  // ── Chat ────────────────────────────────────────────────────────────────────

  /** Synchronous, cache-only read. Call ensureChatHistory() first to warm it. */
  getChatHistory(tenantId: string, passengerId: string): ChatMessage[] {
    return this.chatHistories.get(HubStore.key(tenantId, passengerId)) ?? [];
  }

  /**
   * Load chat history from the repository into the in-memory cache if not
   * already warm, and return it. Awaited from WS hello / chat_fetch handlers.
   */
  async ensureChatHistory(tenantId: string, passengerId: string): Promise<ChatMessage[]> {
    const key = HubStore.key(tenantId, passengerId);
    const cached = this.chatHistories.get(key);
    if (cached?.length) return cached;
    if (!this.chatRepo) return [];
    const loaded = await this.chatRepo.loadRecent(tenantId, passengerId, MAX_CHAT_HISTORY);
    if (loaded.length) this.chatHistories.set(key, loaded);
    return loaded;
  }

  appendChat(tenantId: string, passengerId: string, msg: ChatMessage): void {
    const key = HubStore.key(tenantId, passengerId);
    const hist = this.chatHistories.get(key) || [];
    hist.push(msg);
    if (hist.length > MAX_CHAT_HISTORY) hist.splice(0, hist.length - MAX_CHAT_HISTORY);
    this.chatHistories.set(key, hist);
    // Persist asynchronously; the in-memory cache is authoritative for live reads.
    void this.chatRepo?.append(tenantId, passengerId, msg).catch((err) => {
      logger.error("chat_persist_failed", {
        passengerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Trajectories ─────────────────────────────────────────────────────────────

  setTrajectory(tenantId: string, passengerId: string, data: TrajectoryData): void {
    this.paxTrajectories.set(HubStore.key(tenantId, passengerId), data);
  }

  getTrajectory(tenantId: string, passengerId: string): TrajectoryData | undefined {
    return this.paxTrajectories.get(HubStore.key(tenantId, passengerId));
  }

  deleteTrajectory(tenantId: string, passengerId: string): boolean {
    return this.paxTrajectories.delete(HubStore.key(tenantId, passengerId));
  }

  // ── Broadcast helpers ────────────────────────────────────────────────────────

  broadcastAdmins(tenantId: string, msg: unknown, excludeWs?: WebSocket): void {
    const set = this.adminSockets.get(tenantId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) {
      if (ws === excludeWs) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  broadcastPax(tenantId: string, passengerId: string, msg: unknown): void {
    const key = HubStore.key(tenantId, passengerId);
    const set = this.paxSockets.get(key);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  // ── Message store ─────────────────────────────────────────────────────────────

  recentMessages(tenantId: string, limit = 50): MsgRecord[] {
    return Array.from(this.messages.values())
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  updateMessageStatus(
    messageId: string,
    patch: Partial<Pick<MsgRecord, "status" | "deliveredAt" | "ackAt">>
  ): MsgRecord | null {
    const rec = this.messages.get(messageId);
    if (!rec) return null;
    const updated = { ...rec, ...patch };
    this.messages.set(messageId, updated);
    return updated;
  }
}
