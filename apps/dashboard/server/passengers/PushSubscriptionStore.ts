/**
 * Web Push subscriptions (P2-2), backed by the async SqlDb (P2-1).
 *
 * Persisting subscriptions lets pushes survive restarts and work across
 * instances sharing the same database.
 */
import type { SqlDb } from "../db/sqlDb";

export type PushSub = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

type Row = { endpoint: string; p256dh: string | null; auth: string | null; expiration: number | null };

export class PushSubscriptionStore {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        sub_key     TEXT NOT NULL,
        endpoint    TEXT NOT NULL,
        p256dh      TEXT,
        auth        TEXT,
        expiration  BIGINT,
        created_at  BIGINT NOT NULL,
        PRIMARY KEY (sub_key, endpoint)
      );
    `);
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_push_sub_key ON push_subscriptions (sub_key);",
    );
  }

  /** Insert or refresh a subscription for a passenger key (tenant::pid). */
  async upsert(key: string, sub: PushSub): Promise<void> {
    await this.db.run(
      `INSERT INTO push_subscriptions (sub_key, endpoint, p256dh, auth, expiration, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (sub_key, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         expiration = excluded.expiration`,
      [
        key,
        sub.endpoint,
        sub.keys?.p256dh ?? null,
        sub.keys?.auth ?? null,
        typeof sub.expirationTime === "number" ? sub.expirationTime : null,
        Date.now(),
      ],
    );
  }

  async list(key: string): Promise<PushSub[]> {
    const rows = await this.db.all<Row>(
      "SELECT endpoint, p256dh, auth, expiration FROM push_subscriptions WHERE sub_key = ?",
      [key],
    );
    return rows.map((r) => ({
      endpoint: r.endpoint,
      expirationTime: r.expiration,
      keys: { p256dh: r.p256dh ?? undefined, auth: r.auth ?? undefined },
    }));
  }

  /** Remove a single dead endpoint (e.g. after a 404/410 from the push service). */
  async removeEndpoint(key: string, endpoint: string): Promise<void> {
    await this.db.run(
      "DELETE FROM push_subscriptions WHERE sub_key = ? AND endpoint = ?",
      [key, endpoint],
    );
  }

  /** Remove every subscription for one passenger key — used when the passenger itself is deleted. */
  async removeAllForKey(key: string): Promise<number> {
    const r = await this.db.run("DELETE FROM push_subscriptions WHERE sub_key = ?", [key]);
    return r.changes;
  }
}
