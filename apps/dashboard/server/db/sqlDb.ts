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
import { Pool, type PoolClient, types as pgTypes } from "pg";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DB_DIALECT, DATABASE_URL, DB_PATH } from "../config";
import { logger } from "../lib/logger";

/** BIGINT (oid 20) comes back as string by default; epoch-ms fits in a JS number. */
pgTypes.setTypeParser(20, (v: string) => parseInt(v, 10));

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
  /**
   * Run `fn` in a single transaction: all statements issued through the
   * `tx` handle it receives commit together, or roll back together if `fn`
   * throws. Do not use the outer `SqlDb` (or any other repository sharing
   * it) for statements that must be part of the same transaction — always
   * go through `tx`.
   */
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
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

  /**
   * better-sqlite3 is a single, synchronous connection, so unlike Postgres
   * there's no separate "client" to isolate — BEGIN/COMMIT/ROLLBACK are
   * issued directly and `tx` is just `this`. This is safe for this app's
   * actual usage (batch inserts with no other I/O in between: two `await`s
   * on synchronous better-sqlite3 calls never yield to unrelated code), but
   * unlike the pg path below it does NOT protect against a concurrent
   * caller issuing an unrelated query on this same connection while a
   * transaction is open — acceptable for SQLite's single-process deploy
   * mode (DATABASE_URL/Postgres is the supported path for multi-instance).
   */
  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* the original error is more useful than a rollback failure */ }
      throw err;
    }
  }
}

// ─── Postgres adapter ─────────────────────────────────────────────────────────

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Give up on an unresponsive Postgres rather than hanging a request forever. */
const PG_CONNECTION_TIMEOUT_MS = 5000;
/** Recycle idle connections so a stale pool member can't wedge the app. */
const PG_IDLE_TIMEOUT_MS = 30_000;

/** Either the shared Pool or a single checked-out client — both expose `.query()`. */
type PgQueryable = Pick<Pool | PoolClient, "query">;

/** Shared query implementation, parameterized over the connection it runs on. */
class PgQueries {
  constructor(protected readonly conn: PgQueryable) {}

  async exec(sql: string): Promise<void> {
    await this.conn.query(sql);
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.conn.query(toPgPlaceholders(sql), params as unknown[]);
    return r.rows as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const r = await this.conn.query(toPgPlaceholders(sql), params as unknown[]);
    return (r.rows[0] as T | undefined);
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const r = await this.conn.query(toPgPlaceholders(sql), params as unknown[]);
    return { changes: r.rowCount ?? 0 };
  }
}

/** The `tx` handle passed into a transaction callback: bound to one dedicated client. */
class PgTransactionDb extends PgQueries implements SqlDb {
  readonly dialect = "pg" as const;

  async ping(): Promise<boolean> {
    try { await this.conn.query("SELECT 1"); return true; } catch { return false; }
  }

  async close(): Promise<void> {
    throw new Error("close() is not valid on a transaction handle; close the SqlDb itself instead.");
  }

  async transaction<T>(): Promise<T> {
    throw new Error("Nested transactions are not supported — issue statements via the tx handle you already have.");
  }
}

class PgDb extends PgQueries implements SqlDb {
  readonly dialect = "pg" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
    });
    // node-postgres emits "error" on the pool when an *idle* client hits a
    // network/backend error — an EventEmitter "error" with no listener is
    // fatal in Node (crashes the process) even though the pool itself
    // recovers fine by discarding that client. Without this listener, a
    // single idle-connection blip would take the whole server down.
    pool.on("error", (err: Error) => {
      logger.error("pg_pool_error", { error: err.message });
    });
    super(pool);
    this.pool = pool;
  }

  async ping(): Promise<boolean> {
    try { await this.pool.query("SELECT 1"); return true; } catch { return false; }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Acquires one dedicated connection from the pool for the lifetime of
   * `fn` — required for correctness: BEGIN/COMMIT/ROLLBACK only affect the
   * connection they're issued on, so every statement in the transaction
   * must go through the same client, never the shared pool.
   */
  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgTransactionDb(client);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* the original error is more useful than a rollback failure */ }
      throw err;
    } finally {
      client.release();
    }
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
