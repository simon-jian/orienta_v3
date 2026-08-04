/**
 * Verifies a JWT against every configured secret (current JWT_SECRET, then
 * any JWT_SECRET_PREVIOUS values) in order, succeeding on the first match.
 * This is what lets JWT_SECRET be rotated without an instant hard cutover
 * that invalidates every outstanding admin/passenger session — see
 * config.ts JWT_SECRET_PREVIOUS.
 *
 * Signing is unaffected: SignJWT calls elsewhere still use JWT_SECRET
 * (config.ts's JWT_VERIFICATION_SECRETS[0]) directly — only verification
 * needs to try multiple secrets.
 */
import { jwtVerify, type JWTPayload, type JWTVerifyOptions } from "jose";
import { JWT_VERIFICATION_SECRETS } from "../config";

export async function verifyWithRotatingSecret(
  token: string,
  options: JWTVerifyOptions,
): Promise<JWTPayload> {
  let lastErr: unknown;
  for (const secret of JWT_VERIFICATION_SECRETS) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), options);
      return payload;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
