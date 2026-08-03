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
 * Strips fields that could carry secrets/PII before an event leaves the
 * process, regardless of what attached them (our own `extra` context in
 * captureException() is deliberately minimal already — method/path/ip — but
 * this also guards against Sentry's own request integrations attaching more
 * in the future, or a future call site passing something it shouldn't).
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
  }
  return event;
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
        // Don't let the SDK auto-attach IP/headers/cookies from requests —
        // scrubExtra() below still passes through the few fields this app
        // explicitly wants (method/path/ip) via `extra`, deliberately, not
        // through Sentry's default PII capture.
        sendDefaultPii: false,
        beforeSend: scrubEvent,
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

  // Both handlers exit: Node makes no guarantee the process is still in a
  // consistent state after either kind of unhandled error, so treat them the
  // same — capture, flush, then let the orchestrator (Docker `restart:
  // unless-stopped`, k8s, ...) start a clean instance rather than keep
  // serving requests from a process that might be half-broken.
  const fatal = (err: unknown, kind: "unhandledRejection" | "uncaughtException"): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    captureException(error, { kind });
    void flushErrorTracking(2000).finally(() => process.exit(1));
  };

  process.on("unhandledRejection", (reason) => fatal(reason, "unhandledRejection"));
  process.on("uncaughtException", (err) => fatal(err, "uncaughtException"));
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
