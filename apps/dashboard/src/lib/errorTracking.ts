/**
 * Browser error tracking (P2-5).
 *
 * Optional Sentry integration. When VITE_SENTRY_DSN is unset this is a no-op,
 * so local dev and self-hosted deployments need no external service.
 */
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/**
 * Strips fields that could carry PII before an event leaves the browser.
 * `sendDefaultPii: false` already keeps the SDK from attaching the user's IP;
 * this additionally drops any request/breadcrumb data that could contain a
 * session token or cookie value (e.g. from a captured fetch breadcrumb URL).
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
  }
  event.breadcrumbs = event.breadcrumbs?.map((b) => {
    if (b.category !== "fetch" && b.category !== "xhr") return b;
    const url = typeof b.data?.url === "string" ? b.data.url.replace(/([?&](?:token|authorization)=)[^&]+/gi, "$1<redacted>") : b.data?.url;
    return { ...b, data: { ...b.data, url } };
  });
  return event;
}

export function initErrorTracking(): void {
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    });
  } catch {
    /* telemetry must never break the app */
  }
}

export { Sentry };
