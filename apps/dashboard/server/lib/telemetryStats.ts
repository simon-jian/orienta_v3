/**
 * In-process counters for passenger position telemetry, surfaced by GET /health.
 *
 * Telemetry is best-effort by design: the passenger app never retries hard and
 * never blocks walking on a failed push. That makes silent loss the failure mode
 * to watch for — a throttled or rejected stream looks exactly like "the operator
 * map stopped moving". These counters make it visible without a log dive.
 *
 * Deliberately process-local: the numbers are an operational smell test, not
 * billing data, so they don't need to survive a restart or be summed across
 * instances (each instance reports its own under /health).
 */
type TelemetryStats = {
  accepted: number;
  rateLimited: number;
  rejected: number;
  lastAcceptedAt: number | null;
  lastRateLimitedAt: number | null;
};

const stats: TelemetryStats = {
  accepted: 0,
  rateLimited: 0,
  rejected: 0,
  lastAcceptedAt: null,
  lastRateLimitedAt: null,
};

export function countTelemetryAccepted(): void {
  stats.accepted += 1;
  stats.lastAcceptedAt = Date.now();
}

export function countTelemetryRateLimited(): void {
  stats.rateLimited += 1;
  stats.lastRateLimitedAt = Date.now();
}

/** Authentication or payload rejections (401/403/400). */
export function countTelemetryRejected(): void {
  stats.rejected += 1;
}

export function telemetryStatsSnapshot(): TelemetryStats {
  return { ...stats };
}
