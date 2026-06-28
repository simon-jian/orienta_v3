/**
 * SQLite-backed Web Push subscriptions (P2-2).
 *
 * Previously subscriptions lived in an in-memory Map and were lost on every
 * restart, silently disabling away-notifications. Persisting them lets pushes
 * survive restarts and (eventually) work across instances sharing the DB file.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type PushSub = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

export class PushSubscriptionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        sub_key     TEXT NOT NULL,
        endpoint    TEXT NOT NULL,
        p256dh      TEXT,
        auth        TEXT,
        expiration  INTEGER,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (sub_key, endpoint)
      );
      CREATE INDEX IF NOT EXISTS idx_push_sub_key ON push_subscriptions (sub_key);
    `);
  }

  /** Insert or refresh a subscription for a passenger key (tenant::pid). */
  upsert(key: string, sub: PushSub): void {
    this.db.prepare(`
      INSERT INTO push_subscriptions (sub_key, endpoint, p256dh, auth, expiration, created_at)
      VALUES (@sub_key, @endpoint, @p256dh, @auth, @expiration, @created_at)
      ON CONFLICT(sub_key, endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        expiration = excluded.expiration
    `).run({
      sub_key: key,
      endpoint: sub.endpoint,
      p256dh: sub.keys?.p256dh ?? null,
      auth: sub.keys?.auth ?? null,
      expiration: typeof sub.expirationTime === "number" ? sub.expirationTime : null,
      created_at: Date.now(),
    });
  }

  list(key: string): PushSub[] {
    const rows = this.db.prepare(
      "SELECT endpoint, p256dh, auth, expiration FROM push_subscriptions WHERE sub_key = ?",
    ).all(key) as Array<{ endpoint: string; p256dh: string | null; auth: string | null; expiration: number | null }>;
    return rows.map((r) => ({
      endpoint: r.endpoint,
      expirationTime: r.expiration,
      keys: { p256dh: r.p256dh ?? undefined, auth: r.auth ?? undefined },
    }));
  }

  /** Remove a single dead endpoint (e.g. after a 404/410 from the push service). */
  removeEndpoint(key: string, endpoint: string): void {
    this.db.prepare("DELETE FROM push_subscriptions WHERE sub_key = ? AND endpoint = ?").run(key, endpoint);
  }
}
