/**
 * Rate limiter for Express routes.
 *
 * - Without Redis: in-memory sliding window (single instance).
 * - With Redis (P2-3): shared fixed-window counter (INCR + PEXPIRE) so the limit
 *   is enforced across all instances. Fails open on Redis errors.
 */
import type { Request, Response, NextFunction } from "express";
import type { Redis } from "../redis/redisClient";
import { logger } from "../lib/logger";

type Bucket = { count: number; resetAt: number };

/** How often to sweep expired in-memory buckets for one limiter instance. */
const SWEEP_INTERVAL_MS = 5 * 60_000;

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
  /** Namespace for the Redis key; required when sharing across instances. */
  name?: string;
  /** Shared Redis client; when omitted the limiter is in-memory only. */
  redis?: Redis | null;
  /**
   * When Redis is configured but errors, default is fail-open (allow traffic).
   * Set true for auth-sensitive routes so an outage cannot remove brute-force caps.
   */
  failClosed?: boolean;
}) {
  const buckets = new Map<string, Bucket>();
  const keyFn = options.keyFn ?? ((req) => req.ip || "unknown");
  const redis = options.redis ?? null;
  const ns = options.name ?? "default";

  // Buckets are only ever replaced (not deleted) when the SAME key comes back
  // after expiry — under broad/scanned traffic, unique IPs would otherwise
  // accumulate in this Map for the life of the process. Only relevant for the
  // in-memory path; the Redis path expires keys itself via PEXPIRE.
  if (!redis) {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (now >= bucket.resetAt) buckets.delete(key);
      }
    }, SWEEP_INTERVAL_MS);
    sweep.unref();
  }

  function checkMemory(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = keyFn(req);
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.maxRequests) {
      res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
      return;
    }
    next();
  }

  if (!redis) return checkMemory;

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const redisKey = `orienta:rl:${ns}:${keyFn(req)}`;
    (async () => {
      const count = await redis.incr(redisKey);
      // Set the window TTL only on the first request so the window is fixed.
      if (count === 1) await redis.pexpire(redisKey, options.windowMs);
      if (count > options.maxRequests) {
        res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
        return;
      }
      next();
    })().catch((err: unknown) => {
      logger.error("rate_limit_redis_failed", {
        error: err instanceof Error ? err.message : String(err),
        failClosed: !!options.failClosed,
      });
      if (options.failClosed) {
        res.status(503).json({ ok: false, error: "rate_limit_unavailable" });
        return;
      }
      // Fail open for non-auth routes: prefer availability over a hard outage.
      next();
    });
  };
}
