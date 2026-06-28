/**
 * Generate a scrypt hash for ADMIN_CREDENTIALS / PAX_ACCOUNT_CREDENTIALS (P0-14).
 *
 * Usage (after `npm run build:server`):
 *   node dist-server/server/scripts/hashAdminPassword.js 'my-strong-password'
 *
 * Then put `email:scrypt$<salt>$<hash>` in ADMIN_CREDENTIALS.
 */
import { hashPassword } from "../lib/passwordHash";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node hashAdminPassword.js '<password>'");
  process.exit(1);
}

process.stdout.write(hashPassword(password) + "\n");
