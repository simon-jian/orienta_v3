/**
 * Premium passenger accounts (replaces PAX_ACCOUNT_CREDENTIALS),
 * backed by the async SqlDb (P2-1).
 */
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../lib/passwordHash";
import { PAX_ACCOUNT_CREDENTIALS, ROUTE_SITE_DEFAULT_TENANT } from "../config";
import type { SqlDb } from "../db/sqlDb";
import { logger } from "../lib/logger";

export type PaxAccountRecord = {
  email: string;
  tenantId: string;
  displayName: string;
  plan: "premium";
  createdAt: number;
  updatedAt: number;
};

type Row = {
  email: string;
  tenant_id: string;
  display_name: string;
  plan: string;
  created_at: number;
  updated_at: number;
};

function toRecord(row: Row): PaxAccountRecord {
  return {
    email: row.email,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    plan: "premium",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PaxAccountStore {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS pax_accounts (
        email         TEXT PRIMARY KEY,
        tenant_id     TEXT NOT NULL DEFAULT 'airchina',
        display_name  TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'premium',
        created_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL
      );
    `);
    await this.seedFromEnvIfEmpty();
  }

  private async seedFromEnvIfEmpty(): Promise<void> {
    if (!PAX_ACCOUNT_CREDENTIALS.trim()) return;
    const count = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pax_accounts");
    if ((count?.n ?? 0) > 0) return;

    for (const pair of PAX_ACCOUNT_CREDENTIALS.split(",")) {
      const [email, ...rest] = pair.trim().split(":");
      const password = rest.join(":").trim();
      if (!email || !password) continue;
      await this.upsertAccount({
        email: email.trim().toLowerCase(),
        password,
        displayName: email.split("@")[0] || "Premium Passenger",
      });
    }
    logger.info("pax_accounts_seeded", { source: "PAX_ACCOUNT_CREDENTIALS" });
  }

  async upsertAccount(input: {
    email: string;
    password: string;
    tenantId?: string;
    displayName?: string;
  }): Promise<PaxAccountRecord> {
    const now = Date.now();
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    await this.db.run(
      `INSERT INTO pax_accounts (email, tenant_id, display_name, password_hash, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         display_name = excluded.display_name,
         password_hash = excluded.password_hash,
         plan = excluded.plan,
         updated_at = excluded.updated_at`,
      [
        email,
        input.tenantId?.trim() || ROUTE_SITE_DEFAULT_TENANT,
        input.displayName?.trim() || email.split("@")[0] || "Premium Passenger",
        passwordHash,
        "premium",
        now,
        now,
      ],
    );
    return (await this.getAccount(email))!;
  }

  async getAccount(email: string): Promise<PaxAccountRecord | null> {
    const row = await this.db.get<Row>(
      `SELECT email, tenant_id, display_name, plan, created_at, updated_at
       FROM pax_accounts WHERE email = ?`,
      [email.trim().toLowerCase()],
    );
    return row ? toRecord(row) : null;
  }

  /**
   * Admin: list premium accounts (no password material). Pass `tenantId` to
   * scope to one tenant — omitting it returns every tenant's accounts, so
   * callers should default to the caller's own tenant rather than "all".
   */
  async listAccounts(tenantId?: string): Promise<PaxAccountRecord[]> {
    const rows = tenantId
      ? await this.db.all<Row>(
          `SELECT email, tenant_id, display_name, plan, created_at, updated_at
           FROM pax_accounts WHERE tenant_id = ? ORDER BY email`,
          [tenantId],
        )
      : await this.db.all<Row>(
          `SELECT email, tenant_id, display_name, plan, created_at, updated_at
           FROM pax_accounts ORDER BY email`,
        );
    return rows.map(toRecord);
  }

  /** Admin: delete an account. Returns true when a row was removed. */
  async deleteAccount(email: string): Promise<boolean> {
    const r = await this.db.run(
      "DELETE FROM pax_accounts WHERE email = ?",
      [email.trim().toLowerCase()],
    );
    return r.changes > 0;
  }

  async verifyLogin(email: string, password: string): Promise<PaxAccountRecord | null> {
    const row = await this.db.get<Row & { password_hash: string }>(
      `SELECT email, tenant_id, display_name, password_hash, plan, created_at, updated_at
       FROM pax_accounts WHERE email = ?`,
      [email.trim().toLowerCase()],
    );
    // Always run the scrypt comparison, even for a nonexistent email — against
    // a fixed dummy hash when there's no real row — so the response time
    // doesn't reveal whether the email has an account (timing side-channel).
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !ok) return null;
    return toRecord(row);
  }
}
