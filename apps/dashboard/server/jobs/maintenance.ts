/**
 * Periodic cleanup for stale temporary passengers and old chat / metrics /
 * audit rows.
 */
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type { ChatRepository } from "../hub/ChatRepository";
import type { MetricsRepository } from "../lib/MetricsRepository";
import type { AuditLog } from "../lib/auditLog";
import type { HubStore } from "../hub/HubStore";
import { logger } from "../lib/logger";

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const TEMP_PASSENGER_MAX_AGE_MS = 48 * 60 * 60_000;
const CHAT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const METRICS_RETENTION_MS = 14 * 24 * 60 * 60_000;
/** Longer than chat/metrics: this is a security audit trail, not ephemeral telemetry. */
const AUDIT_LOG_RETENTION_MS = 365 * 24 * 60 * 60_000;

/**
 * Runs one pruning step, logging (and swallowing) its own failure so a
 * problem in one step never stops the others in the same cycle, or the
 * recurring interval itself.
 */
async function runStep(name: string, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    logger.error("maintenance_step_failed", {
      step: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export function startMaintenanceJobs(input: {
  registry: PassengerRegistry;
  chatRepo: ChatRepository;
  metricsRepo?: MetricsRepository;
  auditLog?: AuditLog;
  hubStore?: HubStore;
}): () => void {
  const run = async () => {
    const removedPassengers = await runStep("temp_passengers", () =>
      input.registry.deleteStaleTemporaryPassengers(TEMP_PASSENGER_MAX_AGE_MS),
    );
    const removedChats = await runStep("chat", () => input.chatRepo.pruneOlderThan(CHAT_RETENTION_MS));
    const removedMetrics = input.metricsRepo
      ? await runStep("metrics", () => input.metricsRepo!.pruneOlderThan(METRICS_RETENTION_MS))
      : 0;
    const removedAuditRows = input.auditLog
      ? await runStep("audit_log", () => input.auditLog!.pruneOlderThan(AUDIT_LOG_RETENTION_MS))
      : 0;
    let evictedIdleCaches = 0;
    if (input.hubStore) {
      try {
        evictedIdleCaches = input.hubStore.pruneIdleCaches();
      } catch (err) {
        logger.error("maintenance_step_failed", {
          step: "idle_hub_caches",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (removedPassengers > 0 || removedChats > 0 || removedMetrics > 0 || removedAuditRows > 0 || evictedIdleCaches > 0) {
      logger.info("maintenance_pruned", {
        passengers: removedPassengers,
        chatRows: removedChats,
        metricsRows: removedMetrics,
        auditRows: removedAuditRows,
        idleHubCacheEntries: evictedIdleCaches,
      });
    }
  };

  void run();
  const timer = setInterval(() => { void run(); }, CLEANUP_INTERVAL_MS);
  return () => clearInterval(timer);
}
