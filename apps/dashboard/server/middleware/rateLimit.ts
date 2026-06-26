/**
 * In-memory sliding-window rate limiter for Express routes.
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();
  const keyFn = options.keyFn ?? ((req) => req.ip || "unknown");

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
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
  };
}
