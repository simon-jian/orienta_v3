/**
 * SQLite-backed premium passenger accounts (replaces PAX_ACCOUNT_CREDENTIALS).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { hashPassword, verifyPassword } from "../lib/passwordHash";
import { PAX_ACCOUNT_CREDENTIALS } from "../config";

export type PaxAccountRecord = {
  email: string;
  tenantId: string;
  displayName: string;
  plan: "premium";
  createdAt: number;
  updatedAt: number;
};

export class PaxAccountStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.seedFromEnvIfEmpty();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pax_accounts (
        email         TEXT PRIMARY KEY,
        tenant_id     TEXT NOT NULL DEFAULT 'airchina',
        display_name  TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'premium',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    `);
  }

  private seedFromEnvIfEmpty(): void {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM pax_accounts").get() as { n: number };
    if (count.n > 0 || !PAX_ACCOUNT_CREDENTIALS.trim()) return;

    for (const pair of PAX_ACCOUNT_CREDENTIALS.split(",")) {
      const [email, ...rest] = pair.trim().split(":");
      const password = rest.join(":").trim();
      if (!email || !password) continue;
      this.upsertAccount({
        email: email.trim().toLowerCase(),
        password,
        displayName: email.split("@")[0] || "Premium Passenger",
      });
    }
    console.log("[paxAccounts] Seeded accounts from PAX_ACCOUNT_CREDENTIALS");
  }

  upsertAccount(input: {
    email: string;
    password: string;
    tenantId?: string;
    displayName?: string;
  }): PaxAccountRecord {
    const now = Date.now();
    const email = input.email.trim().toLowerCase();
    const row = {
      email,
      tenant_id: input.tenantId?.trim() || "airchina",
      display_name: input.displayName?.trim() || email.split("@")[0] || "Premium Passenger",
      password_hash: hashPassword(input.password),
      plan: "premium",
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO pax_accounts (email, tenant_id, display_name, password_hash, plan, created_at, updated_at)
      VALUES (@email, @tenant_id, @display_name, @password_hash, @plan, @created_at, @updated_at)
      ON CONFLICT(email) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        plan = excluded.plan,
        updated_at = excluded.updated_at
    `).run(row);
    return this.getAccount(email)!;
  }

  getAccount(email: string): PaxAccountRecord | null {
    const row = this.db.prepare(`
      SELECT email, tenant_id, display_name, plan, created_at, updated_at
      FROM pax_accounts WHERE email = ?
    `).get(email.trim().toLowerCase()) as {
      email: string;
      tenant_id: string;
      display_name: string;
      plan: string;
      created_at: number;
      updated_at: number;
    } | undefined;
    if (!row) return null;
    return {
      email: row.email,
      tenantId: row.tenant_id,
      displayName: row.display_name,
      plan: "premium",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Admin: list all premium accounts (no password material). */
  listAccounts(): PaxAccountRecord[] {
    const rows = this.db.prepare(`
      SELECT email, tenant_id, display_name, plan, created_at, updated_at
      FROM pax_accounts ORDER BY email
    `).all() as Array<{
      email: string;
      tenant_id: string;
      display_name: string;
      plan: string;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      email: row.email,
      tenantId: row.tenant_id,
      displayName: row.display_name,
      plan: "premium",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Admin: delete an account. Returns true when a row was removed. */
  deleteAccount(email: string): boolean {
    const result = this.db.prepare("DELETE FROM pax_accounts WHERE email = ?")
      .run(email.trim().toLowerCase());
    return result.changes > 0;
  }

  verifyLogin(email: string, password: string): PaxAccountRecord | null {
    const normalized = email.trim().toLowerCase();
    const row = this.db.prepare(`
      SELECT email, tenant_id, display_name, password_hash, plan, created_at, updated_at
      FROM pax_accounts WHERE email = ?
    `).get(normalized) as {
      email: string;
      tenant_id: string;
      display_name: string;
      password_hash: string;
      plan: string;
      created_at: number;
      updated_at: number;
    } | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return {
      email: row.email,
      tenantId: row.tenant_id,
      displayName: row.display_name,
      plan: "premium",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
