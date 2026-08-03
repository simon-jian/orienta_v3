/**
 * Admin session revocation.
 *
 * Admin JWTs are stateless, so without this, "logout" only ever cleared the
 * browser's cookie — the token itself (if captured/replayed some other way)
 * stayed valid until its natural expiry (ADMIN_JWT_TTL_S, 8h). This lets
 * POST /api/auth/logout invalidate that specific token immediately.
 *
 * In-memory by default (correct for the documented single-instance
 * deployment) and additionally mirrored to Redis — matching HubStore's
 * presence pattern — so a revocation is honored by every instance in a
 * multi-instance deployment, not just the one that handled the logout.
 */
import { getRedisCmd } from "../redis/redisClient";
import { logger } from "../lib/logger";

const REVOKED_KEY_PREFIX = "orienta:revoked_admin_jti:";
const SWEEP_INTERVAL_MS = 10 * 60_000;

/** jti -> expiresAtMs (the token's own `exp`; no need to remember it past that). */
const locallyRevoked = new Map<string, number>();

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of locallyRevoked) {
    if (now >= expiresAt) locallyRevoked.delete(jti);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

/** Marks `jti` as revoked until `expiresAtMs` (pass the token's own `exp`). */
export async function revokeAdminToken(jti: string, expiresAtMs: number): Promise<void> {
  locallyRevoked.set(jti, expiresAtMs);
  const redis = getRedisCmd();
  if (!redis) return;
  const ttlS = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  try {
    await redis.set(REVOKED_KEY_PREFIX + jti, "1", "EX", ttlS);
  } catch (err) {
    logger.error("admin_token_revoke_redis_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** True if `jti` was revoked (and hasn't yet naturally expired). */
export async function isAdminTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  if (locallyRevoked.has(jti)) return true;
  const redis = getRedisCmd();
  if (!redis) return false;
  try {
    return (await redis.exists(REVOKED_KEY_PREFIX + jti)) === 1;
  } catch {
    // Fail open, matching every other Redis-optional check in this codebase
    // (rate limiting, presence) — a Redis blip must not lock every admin out.
    return false;
  }
}
