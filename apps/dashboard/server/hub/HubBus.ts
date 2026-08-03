/**
 * Cross-instance fan-out bus (P2-3).
 *
 * Every broadcast is delivered to local sockets immediately, then published on
 * the bus so other instances deliver it to *their* local sockets. The origin
 * instance ignores its own messages (already delivered locally) via INSTANCE_ID.
 *
 * MemoryHubBus is a no-op for single-instance deploys.
 */
import type { Redis } from "../redis/redisClient";
import { INSTANCE_ID } from "../config";
import { logger } from "../lib/logger";

export type HubEnvelope =
  | { scope: "admins"; tenantId: string; payload: unknown }
  | { scope: "pax"; tenantId: string; passengerId: string; payload: unknown };

const CHANNEL = "orienta:hub";

export interface HubBus {
  publish(env: HubEnvelope): void;
  close(): void;
}

export class MemoryHubBus implements HubBus {
  publish(): void { /* single instance: local delivery is sufficient */ }
  close(): void { /* nothing to close */ }
}

export class RedisHubBus implements HubBus {
  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
    onRemote: (env: HubEnvelope) => void,
  ) {
    void this.sub.subscribe(CHANNEL).catch((e: unknown) =>
      logger.error("hub_bus_subscribe_failed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    this.sub.on("message", (_channel: string, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { origin: string; env: HubEnvelope };
        if (msg.origin === INSTANCE_ID) return; // already delivered on this instance
        onRemote(msg.env);
      } catch { /* ignore malformed frames */ }
    });
  }

  publish(env: HubEnvelope): void {
    // Fire-and-forget by design (callers don't await fan-out), but a rejection
    // must never escape as an unhandled rejection — errorTracking.ts treats
    // those as fatal (process.exit) so the whole server would go down on a
    // single transient Redis blip instead of just dropping this one broadcast.
    this.pub.publish(CHANNEL, JSON.stringify({ origin: INSTANCE_ID, env })).catch((e: unknown) => {
      logger.error("hub_bus_publish_failed", { error: e instanceof Error ? e.message : String(e) });
    });
  }

  close(): void {
    try { this.pub.disconnect(); } catch { /* ignore */ }
    try { this.sub.disconnect(); } catch { /* ignore */ }
  }
}
