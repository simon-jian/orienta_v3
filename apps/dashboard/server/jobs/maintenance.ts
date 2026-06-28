/**
 * Periodic cleanup for stale temporary passengers and old chat / metrics rows.
 */
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type { ChatRepository } from "../hub/ChatRepository";
import type { MetricsRepository } from "../lib/MetricsRepository";
import { logger } from "../lib/logger";

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const TEMP_PASSENGER_MAX_AGE_MS = 48 * 60 * 60_000;
const CHAT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const METRICS_RETENTION_MS = 14 * 24 * 60 * 60_000;

export function startMaintenanceJobs(input: {
  registry: PassengerRegistry;
  chatRepo: ChatRepository;
  metricsRepo?: MetricsRepository;
}): () => void {
  const run = async () => {
    const removedPassengers = await input.registry.deleteStaleTemporaryPassengers(TEMP_PASSENGER_MAX_AGE_MS);
    const removedChats = await input.chatRepo.pruneOlderThan(CHAT_RETENTION_MS);
    const removedMetrics = input.metricsRepo ? await input.metricsRepo.pruneOlderThan(METRICS_RETENTION_MS) : 0;
    if (removedPassengers > 0 || removedChats > 0 || removedMetrics > 0) {
      logger.info("maintenance_pruned", {
        passengers: removedPassengers,
        chatRows: removedChats,
        metricsRows: removedMetrics,
      });
    }
  };

  void run();
  const timer = setInterval(() => { void run(); }, CLEANUP_INTERVAL_MS);
  return () => clearInterval(timer);
}
