/**
 * Rate limiter for Express routes.
 *
 * - Without Redis: in-memory sliding window (single instance).
 * - With Redis (P2-3): shared fixed-window counter (INCR + PEXPIRE) so the limit
 *   is enforced across all instances. Fails open on Redis errors.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Redis } from "../redis/redisClient";
import { logger } from "../lib/logger";

type Bucket = { count: number; resetAt: number };

/**
 * Bucket key for authenticated passenger routes: the session, not the IP.
 *
 * An airport's WiFi (or any carrier NAT) puts hundreds of passengers behind one
 * address, and per-IP buckets make them throttle each other. The token is only
 * fingerprinted, never verified, here — that is the route handler's job, and a
 * request with a bogus token is rejected there anyway. Callers should keep a
 * coarse per-IP limiter in front so bogus tokens can't be sprayed to mint
 * unlimited buckets.
 */
export function paxIdentityKey(req: Request): string {
  const header = String(req.headers.authorization || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return `ip:${req.ip || "unknown"}`;
  return `sess:${crypto.createHash("sha256").update(token).digest("base64url").slice(0, 22)}`;
}

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
  /** Called on each rejected request, for per-feature counters. */
  onLimited?: (req: Request) => void;
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

  /**
   * Rejections used to be invisible, which let a client hammering a shared
   * budget look like "the feature just stopped working". Logged once per key per
   * window (on the first breach) so a flood can't spam the log.
   */
  function reportLimited(req: Request, key: string, firstBreach: boolean): void {
    options.onLimited?.(req);
    if (!firstBreach) return;
    logger.warn("rate_limit_exceeded", {
      limiter: ns,
      path: req.path,
      method: req.method,
      keyKind: key.startsWith("sess:") ? "session" : "ip",
      maxRequests: options.maxRequests,
      windowMs: options.windowMs,
    });
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
      reportLimited(req, key, bucket.count === options.maxRequests + 1);
      res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
      return;
    }
    next();
  }

  if (!redis) return checkMemory;

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const key = keyFn(req);
    const redisKey = `orienta:rl:${ns}:${key}`;
    (async () => {
      const count = await redis.incr(redisKey);
      // Set the window TTL only on the first request so the window is fixed.
      if (count === 1) await redis.pexpire(redisKey, options.windowMs);
      if (count > options.maxRequests) {
        reportLimited(req, key, count === options.maxRequests + 1);
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
