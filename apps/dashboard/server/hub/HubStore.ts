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
import type { HubBus, HubEnvelope } from "./HubBus";
import type { Redis } from "../redis/redisClient";
import { logger } from "../lib/logger";

const MAX_CHAT_HISTORY = 100;
/**
 * A passenger's presence entry is considered stale (and excluded from
 * listOnlineGlobal) after this long without a heartbeat. Paired with
 * PRESENCE_HEARTBEAT_INTERVAL_MS in server.ts, which re-stamps every
 * locally-connected passenger well inside this window — a passenger who
 * disconnects ungracefully (crash, network drop with no close frame) simply
 * stops being re-stamped and ages out, rather than staying "online" in Redis
 * forever the way a plain SADD/SREM set would after a crash.
 */
const PRESENCE_STALE_MS = 6 * 60_000;
/**
 * A passenger's chatHistories/paxMeta/paxTrajectories cache entry is eligible
 * for eviction once it's been this long since it was last touched AND the
 * passenger isn't currently connected — see pruneIdleCaches(). Comfortably
 * longer than the temporary-passenger grace window (48h) so a returning
 * passenger's chat history is very unlikely to have been evicted, but still
 * bounded — without this, every passenger who ever connects and later goes
 * offline (without being deleted) stays cached in memory forever.
 */
const IDLE_CACHE_MAX_AGE_MS = 72 * 60 * 60_000;

export type PaxMeta = { displayName?: string; plan?: string };
export type TrajectoryData = {
  path: { lat: number; lng: number }[];
  position: { lat: number; lng: number };
};

export class HubStore {
  constructor(private readonly chatRepo?: ChatRepository) {}

  // ── Cross-instance coordination (P2-3) ───────────────────────────────────────
  // Both are null in single-instance mode (in-memory fan-out + local presence).
  private bus: HubBus | null = null;
  private redis: Redis | null = null;

  /** Wire up Redis fan-out + shared presence. Called once at startup. */
  attachCluster(opts: { bus: HubBus; redis: Redis | null }): void {
    this.bus = opts.bus;
    this.redis = opts.redis;
  }

  private presenceKey(tenantId: string): string {
    return `orienta:presence:${tenantId}`;
  }

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
  /** When each key's chatHistories/paxMeta/paxTrajectories entry was last touched — see pruneIdleCaches(). */
  private readonly lastTouched = new Map<string, number>();

  private touch(key: string): void {
    this.lastTouched.set(key, Date.now());
  }

  /** Sets a passenger's display-name/plan override, tracked for idle eviction (see pruneIdleCaches()). */
  setPaxMeta(tenantId: string, passengerId: string, meta: PaxMeta): void {
    const key = HubStore.key(tenantId, passengerId);
    this.paxMeta.set(key, meta);
    this.touch(key);
  }

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

  /**
   * Cluster-wide online list. With Redis, returns the union across instances;
   * otherwise the local set. Always unioned with local for resilience.
   */
  async listOnlineGlobal(tenantId: string): Promise<string[]> {
    const local = this.listOnline(tenantId);
    if (!this.redis) return local;
    try {
      // A sorted set scored by last-heartbeat time — see PRESENCE_STALE_MS.
      // Members with no recent heartbeat (e.g. a crashed instance's
      // passengers) fall out of this range instead of lingering forever.
      const members = await this.redis.zrangebyscore(
        this.presenceKey(tenantId),
        Date.now() - PRESENCE_STALE_MS,
        "+inf",
      );
      return Array.from(new Set([...local, ...members]));
    } catch {
      return local;
    }
  }

  /**
   * Record presence in the shared store (Redis sorted set, scored by time so
   * stale entries age out — see PRESENCE_STALE_MS). No-op without Redis.
   * Also called periodically as a heartbeat for still-connected passengers —
   * see heartbeatLocalPresence() / server.ts's presence heartbeat interval.
   */
  recordPresence(tenantId: string, passengerId: string, online: boolean): void {
    if (!this.redis) return;
    const key = this.presenceKey(tenantId);
    const op = online
      ? this.redis.zadd(key, Date.now(), passengerId)
      : this.redis.zrem(key, passengerId);
    void op.catch((err: unknown) =>
      logger.error("presence_redis_failed", {
        passengerId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  /**
   * Re-stamps every passenger with an open WebSocket on THIS instance so
   * their Redis presence entry doesn't age out past PRESENCE_STALE_MS while
   * still genuinely connected. Call on a timer well inside that window (see
   * server.ts) — passengers who actually disconnect (gracefully or not)
   * simply stop appearing in `paxSockets` and stop being re-stamped.
   */
  heartbeatLocalPresence(): void {
    if (!this.redis) return;
    for (const key of this.paxSockets.keys()) {
      const sep = key.indexOf("::");
      if (sep < 0) continue;
      const tenantId = key.slice(0, sep);
      const passengerId = key.slice(sep + 2);
      this.recordPresence(tenantId, passengerId, true);
    }
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
    if (cached?.length) { this.touch(key); return cached; }
    if (!this.chatRepo) return [];
    const loaded = await this.chatRepo.loadRecent(tenantId, passengerId, MAX_CHAT_HISTORY);
    if (loaded.length) { this.chatHistories.set(key, loaded); this.touch(key); }
    return loaded;
  }

  appendChat(tenantId: string, passengerId: string, msg: ChatMessage): void {
    const key = HubStore.key(tenantId, passengerId);
    const hist = this.chatHistories.get(key) || [];
    hist.push(msg);
    if (hist.length > MAX_CHAT_HISTORY) hist.splice(0, hist.length - MAX_CHAT_HISTORY);
    this.chatHistories.set(key, hist);
    this.touch(key);
    // Persist asynchronously; the in-memory cache is authoritative for live reads.
    void this.chatRepo?.append(tenantId, passengerId, msg).catch((err) => {
      logger.error("chat_persist_failed", {
        passengerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Removes every trace of one passenger from both the DB-backed chat history
   * and this process's in-memory caches. Called when an admin deletes the
   * passenger record itself (server/routes/passengers.ts DELETE) — without
   * this, the deleted passenger's chat history/one-way messages keep showing
   * up if a new passenger is ever assigned the same id, and the in-memory
   * caches leak until the pruning job's next pass (or forever, for messages,
   * which the pruning job doesn't touch at all).
   */
  async purgePassenger(tenantId: string, passengerId: string): Promise<{ chatRowsDeleted: number }> {
    const key = HubStore.key(tenantId, passengerId);
    this.chatHistories.delete(key);
    this.paxMeta.delete(key);
    this.paxTrajectories.delete(key);
    this.lastTouched.delete(key);
    for (const [messageId, rec] of this.messages) {
      if (rec.tenantId === tenantId && rec.passengerId === passengerId) this.messages.delete(messageId);
    }
    const chatRowsDeleted = (await this.chatRepo?.deleteForPassenger(tenantId, passengerId)) ?? 0;
    return { chatRowsDeleted };
  }

  /**
   * Evicts chatHistories/paxMeta/paxTrajectories entries for passengers that
   * are both currently disconnected AND haven't been touched in over
   * `maxIdleMs` (default IDLE_CACHE_MAX_AGE_MS) — called from the hourly
   * maintenance job (server/jobs/maintenance.ts). A currently-connected
   * passenger's entry is never evicted regardless of `lastTouched`, since a
   * long-lived, quiet WS connection is still real activity. Returns the
   * number of keys evicted.
   */
  pruneIdleCaches(maxIdleMs = IDLE_CACHE_MAX_AGE_MS): number {
    const cutoff = Date.now() - maxIdleMs;
    const candidateKeys = new Set<string>([
      ...this.chatHistories.keys(),
      ...this.paxMeta.keys(),
      ...this.paxTrajectories.keys(),
    ]);
    let evicted = 0;
    for (const key of candidateKeys) {
      if (this.paxSockets.has(key)) continue; // currently connected — never evict
      const touchedAt = this.lastTouched.get(key) ?? 0;
      if (touchedAt >= cutoff) continue;
      this.chatHistories.delete(key);
      this.paxMeta.delete(key);
      this.paxTrajectories.delete(key);
      this.lastTouched.delete(key);
      evicted += 1;
    }
    return evicted;
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
    this.deliverAdminsLocal(tenantId, msg, excludeWs);
    // Propagate to other instances. excludeWs is local-only (remote instances
    // don't hold that socket), so it isn't forwarded.
    this.bus?.publish({ scope: "admins", tenantId, payload: msg });
  }

  broadcastPax(tenantId: string, passengerId: string, msg: unknown): void {
    this.deliverPaxLocal(tenantId, passengerId, msg);
    this.bus?.publish({ scope: "pax", tenantId, passengerId, payload: msg });
  }

  /** Deliver an envelope received from another instance to local sockets only. */
  deliverRemote(env: HubEnvelope): void {
    if (env.scope === "admins") {
      this.deliverAdminsLocal(env.tenantId, env.payload);
    } else {
      this.deliverPaxLocal(env.tenantId, env.passengerId, env.payload);
    }
  }

  private deliverAdminsLocal(tenantId: string, msg: unknown, excludeWs?: WebSocket): void {
    const set = this.adminSockets.get(tenantId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) {
      if (ws === excludeWs) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private deliverPaxLocal(tenantId: string, passengerId: string, msg: unknown): void {
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
