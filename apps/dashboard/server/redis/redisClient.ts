/**
 * Redis connection factory (P2-3).
 *
 * Returns null when REDIS_URL is unset, so callers transparently fall back to
 * single-instance in-memory behavior.
 */
import { Redis } from "ioredis";
import { REDIS_URL, REDIS_ENABLED } from "../config";
import { logger } from "../lib/logger";

export type { Redis };

/**
 * Caps the delay between reconnect attempts (ioredis's own default already
 * caps around 2s, but leaving it implicit meant nobody had actually decided
 * that number). Deliberately does NOT return null/give up after N attempts:
 * every Redis-backed feature in this app (rate limiting, presence, hub fan-
 * out) already fails open with no Redis at all, so an extended outage should
 * keep trying to recover in the background forever, not stop and require a
 * process restart once Redis comes back.
 */
const MAX_RECONNECT_DELAY_MS = 10_000;
/** Log a warning this often (in attempt count) during an extended outage, so it's visible without spamming on every retry. */
const RECONNECT_WARN_EVERY_N_ATTEMPTS = 20;

function make(role: string): Redis {
  const c = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    // Without these, a stalled Redis (network partition, overloaded server)
    // hangs every caller indefinitely instead of surfacing an error to fall
    // back on (rate limiter fails open, hub bus logs and drops the message).
    connectTimeout: 5000,
    commandTimeout: 3000,
    retryStrategy(times) {
      if (times % RECONNECT_WARN_EVERY_N_ATTEMPTS === 0) {
        logger.warn("redis_reconnect_still_failing", { role, attempts: times });
      }
      return Math.min(times * 100, MAX_RECONNECT_DELAY_MS);
    },
  });
  c.on("error", (e: Error) => logger.error("redis_error", { role, error: e.message }));
  c.on("connect", () => logger.info("redis_connected", { role }));
  return c;
}

let cmd: Redis | null = null;

/** Shared command connection (SADD, INCR, …). Reused across the process. */
export function getRedisCmd(): Redis | null {
  if (!REDIS_ENABLED) return null;
  if (!cmd) cmd = make("cmd");
  return cmd;
}

/** Dedicated connection (e.g. for pub or sub, which can't share the cmd socket). */
export function createRedisConnection(role: string): Redis | null {
  return REDIS_ENABLED ? make(role) : null;
}
