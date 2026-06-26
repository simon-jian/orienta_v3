/**
 * Periodic cleanup for stale temporary passengers and old chat rows.
 */
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import type { ChatRepository } from "../hub/ChatRepository";

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const TEMP_PASSENGER_MAX_AGE_MS = 48 * 60 * 60_000;
const CHAT_RETENTION_MS = 30 * 24 * 60 * 60_000;

export function startMaintenanceJobs(input: {
  registry: PassengerRegistry;
  chatRepo: ChatRepository;
}): () => void {
  const run = () => {
    const removedPassengers = input.registry.deleteStaleTemporaryPassengers(TEMP_PASSENGER_MAX_AGE_MS);
    const removedChats = input.chatRepo.pruneOlderThan(CHAT_RETENTION_MS);
    if (removedPassengers > 0 || removedChats > 0) {
      console.log(`[maintenance] removed ${removedPassengers} passengers, ${removedChats} chat rows`);
    }
  };

  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  return () => clearInterval(timer);
}
