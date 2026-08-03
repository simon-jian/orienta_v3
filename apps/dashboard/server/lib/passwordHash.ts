/**
 * Password hashing with Node.js scrypt (no external bcrypt dependency).
 *
 * Uses the async (threadpool-backed) `crypto.scrypt`, not `scryptSync`: the
 * sync version blocks Node's single main event loop for the full ~tens-of-ms
 * cost of every hash/verify, which — since this app's default SQLite path is
 * also synchronous — meant one login could stall every other concurrent
 * request on the process. The async version runs on libuv's threadpool
 * instead, so a login no longer blocks unrelated requests.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// `util.promisify(crypto.scrypt)` resolves to the wrong overload (drops the
// options parameter) — wrap it explicitly instead.
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Returns `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * A syntactically valid, never-matching encoded hash with the same shape as a
 * real one. Callers compare against this (instead of skipping the comparison
 * entirely) when no account/credential exists for the submitted identifier,
 * so a missing-account response takes the same time as a wrong-password one
 * — otherwise the timing difference (skip scrypt vs. run it) leaks which
 * emails have an account.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${"ab".repeat(16)}$${"cd".repeat(SCRYPT_KEY_LENGTH)}`;

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (!salt.length || expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}
