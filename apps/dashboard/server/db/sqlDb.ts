/**
 * Async SQL abstraction with two dialects (P2-1).
 *
 * Repositories target this interface with positional `?` placeholders and
 * snake_case columns. The SQLite adapter wraps the synchronous better-sqlite3
 * API in promises; the Postgres adapter rewrites `?` → `$n` and uses a pool.
 *
 * Default is SQLite (single-machine). Set DATABASE_URL to switch to Postgres
 * for multi-instance / HA deploys.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DB_DIALECT, DATABASE_URL, DB_PATH } from "../config";

export type Dialect = "sqlite" | "pg";

export interface SqlDb {
  readonly dialect: Dialect;
  /** Run DDL / multi-statement scripts (no params). */
  exec(sql: string): Promise<void>;
  /** Return all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Return the first row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Execute a write; returns affected row count. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Liveness ping. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

// ─── SQLite adapter ───────────────────────────────────────────────────────────

class SqliteDb implements SqlDb {
  readonly dialect = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const r = this.db.prepare(sql).run(...params);
    return { changes: r.changes };
  }

  async ping(): Promise<boolean> {
    try { this.db.prepare("SELECT 1").get(); return true; } catch { return false; }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// ─── Postgres adapter ─────────────────────────────────────────────────────────

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PgDb implements SqlDb {
  readonly dialect = "pg" as const;
  // Loaded lazily so SQLite-only deploys never touch the pg driver.
  private pool: import("pg").Pool;

  constructor(connectionString: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require("pg") as typeof import("pg");
    // BIGINT (oid 20) comes back as string by default; epoch-ms fits in a JS number.
    pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(toPgPlaceholders(sql), params as unknown[]);
    return r.rows as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const r = await this.pool.query(toPgPlaceholders(sql), params as unknown[]);
    return (r.rows[0] as T | undefined);
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const r = await this.pool.query(toPgPlaceholders(sql), params as unknown[]);
    return { changes: r.rowCount ?? 0 };
  }

  async ping(): Promise<boolean> {
    try { await this.pool.query("SELECT 1"); return true; } catch { return false; }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let shared: SqlDb | null = null;

/** Create (once) the process-wide SqlDb based on env (DATABASE_URL → pg, else sqlite). */
export function getSqlDb(): SqlDb {
  if (shared) return shared;
  shared = DB_DIALECT === "pg" ? new PgDb(DATABASE_URL) : new SqliteDb(DB_PATH);
  return shared;
}

/** Helper for dialect-specific DDL (autoincrement PK differs between engines). */
export function autoIncrementPk(dialect: Dialect): string {
  return dialect === "pg" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
}

/** Construct a standalone SQLite SqlDb (used by tests). */
export function createSqliteDb(dbPath: string): SqlDb {
  return new SqliteDb(dbPath);
}

/** Construct a standalone Postgres SqlDb for a connection string (used by tests). */
export function createPgDb(connectionString: string): SqlDb {
  return new PgDb(connectionString);
}
