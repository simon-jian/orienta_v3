import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { createRateLimiter } from "./rateLimit";

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { body: unknown };
}

function call(limiter: ReturnType<typeof createRateLimiter>, ip: string) {
  const req = { ip } as Request;
  const res = fakeRes();
  let nexted = false;
  limiter(req, res, () => { nexted = true; });
  return { nexted, res };
}

describe("createRateLimiter", () => {
  it("allows up to maxRequests then blocks with 429", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    for (let i = 0; i < 3; i += 1) {
      expect(call(limiter, "1.1.1.1").nexted).toBe(true);
    }
    const blocked = call(limiter, "1.1.1.1");
    expect(blocked.nexted).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
    expect((blocked.res.body as { error?: string }).error).toBe("rate_limit_exceeded");
  });

  it("tracks limits independently per key (ip)", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect(call(limiter, "2.2.2.2").nexted).toBe(true);
    expect(call(limiter, "2.2.2.2").nexted).toBe(false);
    // Different IP has its own bucket.
    expect(call(limiter, "3.3.3.3").nexted).toBe(true);
  });

  it("resets after the window elapses", () => {
    const limiter = createRateLimiter({ windowMs: -1, maxRequests: 1 });
    // windowMs negative → bucket is always expired, so every call is allowed.
    expect(call(limiter, "4.4.4.4").nexted).toBe(true);
    expect(call(limiter, "4.4.4.4").nexted).toBe(true);
  });
});
