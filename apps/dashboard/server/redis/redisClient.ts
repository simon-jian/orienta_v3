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

function make(role: string): Redis {
  const c = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    // Without these, a stalled Redis (network partition, overloaded server)
    // hangs every caller indefinitely instead of surfacing an error to fall
    // back on (rate limiter fails open, hub bus logs and drops the message).
    connectTimeout: 5000,
    commandTimeout: 3000,
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
