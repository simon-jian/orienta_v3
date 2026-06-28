/**
 * Request-ID + access logging middleware (P1-3).
 *
 * Assigns each request a short id (honoring an inbound X-Request-Id), echoes it
 * back on the response, and logs one structured line per completed request.
 */
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export type RequestWithId = Request & { id?: string };

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const inbound = String(req.headers["x-request-id"] || "").trim();
  const id = inbound || randomUUID().slice(0, 8);
  (req as RequestWithId).id = id;
  res.setHeader("X-Request-Id", id);

  // Capture at entry: Express rewrites req.path inside sub-routers before `finish`.
  const fullPath = (req.originalUrl || req.url || "").split("?")[0] || req.path;
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    // Skip noisy health probes at info level.
    if (fullPath === "/health" && level === "info") return;
    logger[level]("http_request", {
      reqId: id,
      method: req.method,
      path: fullPath,
      status: res.statusCode,
      durMs: Math.round(durMs * 10) / 10,
    });
  });

  next();
}
