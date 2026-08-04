/**
 * Passenger session revocation.
 *
 * A passenger's plan/capabilities are frozen into their session JWT at issue
 * time (server/routes/paxSessions.ts). When an admin deletes a passenger or
 * changes their plan, every already-issued token for that passenger needs to
 * stop reflecting the old state — not just sessions issued from then on.
 *
 * Rather than tracking individual token/session ids (there can be several
 * live tokens per passenger — one per device/tab), this tracks a per-passenger
 * "issued before this time are all invalid" cutover, checked against each
 * token's own standard `iat` claim. One admin action invalidates every
 * outstanding session for that passenger in one write.
 *
 * In-memory by default (correct for the documented single-instance
 * deployment) and mirrored to Redis — matching adminSessionRevocation.ts and
 * HubStore's presence pattern — so multi-instance deployments honor it too.
 */
import { getRedisCmd } from "../redis/redisClient";
import { logger } from "../lib/logger";

const REVOKED_KEY_PREFIX = "orienta:pax_session_cutover:";
/** Must outlive the longest-lived pax session (registered accounts: 30 days — see paxSessions.ts REGISTERED_SESSION_TTL_MS). */
const CUTOVER_TTL_MS = 31 * 24 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;

/** `tenantId::passengerId` -> cutoverAtMs (tokens issued before this are invalid). */
const localCutover = new Map<string, number>();

const sweepTimer = setInterval(() => {
  const cutoff = Date.now() - CUTOVER_TTL_MS;
  for (const [key, cutoverAt] of localCutover) {
    if (cutoverAt < cutoff) localCutover.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

function cutoverKey(tenantId: string, passengerId: string): string {
  return `${tenantId}::${passengerId}`;
}

/** Invalidates every session token issued for this passenger up to now. */
export async function revokePaxSessionsForPassenger(tenantId: string, passengerId: string): Promise<void> {
  const now = Date.now();
  const key = cutoverKey(tenantId, passengerId);
  localCutover.set(key, now);
  const redis = getRedisCmd();
  if (!redis) return;
  try {
    await redis.set(REVOKED_KEY_PREFIX + key, String(now), "EX", Math.ceil(CUTOVER_TTL_MS / 1000));
  } catch (err) {
    logger.error("pax_session_revoke_redis_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** True if a token issued at `issuedAtMs` for this passenger has since been revoked. */
export async function isPaxSessionRevoked(
  tenantId: string,
  passengerId: string,
  issuedAtMs: number,
): Promise<boolean> {
  const key = cutoverKey(tenantId, passengerId);
  const local = localCutover.get(key);
  if (local != null && issuedAtMs < local) return true;
  const redis = getRedisCmd();
  if (!redis) return false;
  try {
    const raw = await redis.get(REVOKED_KEY_PREFIX + key);
    if (!raw) return false;
    return issuedAtMs < Number(raw);
  } catch {
    // Fail open, matching every other Redis-optional check in this codebase.
    return false;
  }
}
