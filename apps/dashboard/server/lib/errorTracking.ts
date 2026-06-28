/**
 * Error tracking (P2-5).
 *
 * Thin wrapper around Sentry that is fully optional: when SENTRY_DSN is unset,
 * every function here is a no-op and errors are still surfaced through the
 * structured logger. This keeps local/offline dev dependency-free while giving
 * production a single place to ship exceptions.
 *
 * Responsibilities:
 *   - initErrorTracking(): boot the Sentry SDK + install process-level guards.
 *   - captureException(): log + forward an error with context.
 *   - expressErrorHandler: terminal Express middleware (logs, captures, 500 JSON).
 *   - flushErrorTracking(): drain the queue during graceful shutdown.
 */
import type { ErrorRequestHandler, Request } from "express";
import * as Sentry from "@sentry/node";

import {
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE,
  INSTANCE_ID,
} from "../config";
import { logger } from "./logger";

let enabled = false;

export function isErrorTrackingEnabled(): boolean {
  return enabled;
}

/**
 * Initialise Sentry (if configured) and install process-level handlers.
 * Safe to call exactly once at startup; guards against double-init.
 */
export function initErrorTracking(): void {
  if (SENTRY_DSN && !enabled) {
    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: SENTRY_ENVIRONMENT,
        release: SENTRY_RELEASE || undefined,
        tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
        // Tag every event with the instance so multi-instance deploys are
        // distinguishable in the Sentry UI (P2-3).
        initialScope: { tags: { instance: INSTANCE_ID } },
      });
      enabled = true;
      logger.info("error_tracking_ready", {
        provider: "sentry",
        environment: SENTRY_ENVIRONMENT,
        release: SENTRY_RELEASE || undefined,
      });
    } catch (err) {
      logger.error("error_tracking_init_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  installProcessHandlers();
}

let processHandlersInstalled = false;

function installProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { kind: "unhandledRejection" });
  });

  process.on("uncaughtException", (err) => {
    captureException(err, { kind: "uncaughtException" });
    // The process is in an undefined state after an uncaught exception; flush
    // the queue then exit so the orchestrator can restart a clean instance.
    void flushErrorTracking(2000).finally(() => process.exit(1));
  });
}

/** Log an error and forward it to Sentry (when enabled) with optional context. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error("captured_exception", {
    error: error.message,
    stack: error.stack,
    ...context,
  });
  if (!enabled) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* never let telemetry crash the app */
  }
}

function requestContext(req: Request): Record<string, unknown> {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
  };
}

/**
 * Terminal Express error handler. Mount AFTER all routes. Logs + captures the
 * error and returns a generic 500 (never leaks stack traces to clients).
 */
export const expressErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Delegate to Express's default handler if the response has already started.
  if (res.headersSent) return next(err);
  captureException(err, requestContext(req));
  res.status(500).json({ error: "internal_error" });
};

/** Drain pending events during graceful shutdown. Returns true if flushed. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<boolean> {
  if (!enabled) return true;
  try {
    return await Sentry.close(timeoutMs);
  } catch {
    return false;
  }
}
