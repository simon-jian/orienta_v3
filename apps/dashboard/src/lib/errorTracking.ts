/**
 * Browser error tracking (P2-5).
 *
 * Optional Sentry integration. When VITE_SENTRY_DSN is unset this is a no-op,
 * so local dev and self-hosted deployments need no external service.
 */
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initErrorTracking(): void {
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
      tracesSampleRate: 0,
    });
  } catch {
    /* telemetry must never break the app */
  }
}

export { Sentry };
