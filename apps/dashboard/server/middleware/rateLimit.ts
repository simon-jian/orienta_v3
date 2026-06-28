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

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
  /** Namespace for the Redis key; required when sharing across instances. */
  name?: string;
  /** Shared Redis client; when omitted the limiter is in-memory only. */
  redis?: Redis | null;
}) {
  const buckets = new Map<string, Bucket>();
  const keyFn = options.keyFn ?? ((req) => req.ip || "unknown");
  const redis = options.redis ?? null;
  const ns = options.name ?? "default";

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
      // Fail open: never block traffic because the limiter backend is down.
      logger.error("rate_limit_redis_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    });
  };
}
