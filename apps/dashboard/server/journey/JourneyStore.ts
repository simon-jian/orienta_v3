/**
 * Persists per-flight journey preferences, progress events, and arrival-plan
 * shares. Uses the shared SqlDb (SQLite or Postgres) — not a separate DB file.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SqlDb } from "../db/sqlDb";
import type {
  AddJourneyEvent,
  CreateOrReuseShareResult,
  JourneyEvent,
  JourneyEventType,
  JourneyKey,
  JourneyPreferences,
  JourneyPreferencesUpdate,
  PublicArrivalPlanShare,
} from "./journeyTypes";

export type {
  AddJourneyEvent,
  CreateOrReuseShareResult,
  JourneyEvent,
  JourneyEventType,
  JourneyKey,
  JourneyPreferences,
  JourneyPreferencesUpdate,
  PublicArrivalPlanShare,
} from "./journeyTypes";

interface PreferencesRow {
  flight_identifier: string;
  flight_date: string;
  checked_bags: number | null;
  departure_security_lane: string | null;
  arrival_seat: string | null;
  arrival_seat_zone: string | null;
  arrival_destination: string | null;
  immigration_lane: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  flight_identifier: string;
  flight_date: string;
  event_type: JourneyEventType;
  event_rank: number;
  source: string;
  event_time: string;
  corrected_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShareRow {
  share_id: string;
  flight_identifier: string;
  flight_date: string;
  public_token_hash: Buffer | string;
  management_token_hash: Buffer | string;
  expires_at: string;
  revoked_at: string | null;
  last_accessed_at: string | null;
}

const EVENT_RANK: Record<JourneyEventType, number> = {
  off_plane: 10,
  bags_collected: 20,
  outside: 30,
};
const SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000;

function normalizeKey(key: JourneyKey): JourneyKey {
  const flightIdentifier = key.flightIdentifier.trim().toUpperCase().replace(/\s+/g, "");
  if (!flightIdentifier) throw new Error("flightIdentifier is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key.flightDate)) {
    throw new Error("flightDate must use YYYY-MM-DD");
  }
  const date = new Date(`${key.flightDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== key.flightDate) {
    throw new Error("flightDate is invalid");
  }
  return { flightIdentifier, flightDate: key.flightDate };
}

function utcTimestamp(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("eventTime must be a valid timestamp");
  return date.toISOString();
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function asBuffer(value: Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") {
    // Postgres bytea may arrive as hex (\x...) or raw binary string.
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "binary");
  }
  return Buffer.from(value);
}

function tokenMatches(token: string, expectedHash: Buffer | string): boolean {
  const actual = tokenHash(token);
  const expected = asBuffer(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cleanOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const cleaned = value.trim();
  return cleaned || null;
}

function mapPreferences(row: PreferencesRow | undefined, key: JourneyKey): JourneyPreferences {
  if (!row) {
    return {
      ...key,
      checkedBags: null,
      departureSecurityLane: null,
      arrivalSeat: null,
      arrivalSeatZone: null,
      arrivalDestination: null,
      immigrationLane: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    flightIdentifier: row.flight_identifier,
    flightDate: row.flight_date,
    checkedBags: row.checked_bags === null ? null : row.checked_bags === 1,
    departureSecurityLane: row.departure_security_lane,
    arrivalSeat: row.arrival_seat,
    arrivalSeatZone: row.arrival_seat_zone,
    arrivalDestination: row.arrival_destination,
    immigrationLane: row.immigration_lane,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): JourneyEvent {
  return {
    id: row.id,
    flightIdentifier: row.flight_identifier,
    flightDate: row.flight_date,
    eventType: row.event_type,
    eventRank: row.event_rank,
    source: row.source,
    eventTime: row.event_time,
    correctedAt: row.corrected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JourneyStore {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    const blob = this.db.dialect === "pg" ? "BYTEA" : "BLOB";
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS journey_preferences (
        flight_identifier TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        checked_bags INTEGER,
        departure_security_lane TEXT,
        arrival_seat TEXT,
        arrival_seat_zone TEXT,
        arrival_destination TEXT,
        immigration_lane TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (flight_identifier, flight_date)
      );

      CREATE TABLE IF NOT EXISTS passenger_journey_events (
        id TEXT NOT NULL PRIMARY KEY,
        flight_identifier TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_rank INTEGER NOT NULL,
        source TEXT NOT NULL,
        event_time TEXT NOT NULL,
        corrected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_journey_events_key
        ON passenger_journey_events (flight_identifier, flight_date, event_rank);

      CREATE TABLE IF NOT EXISTS arrival_plan_shares (
        share_id TEXT NOT NULL PRIMARY KEY,
        flight_identifier TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        public_token_hash ${blob} NOT NULL,
        management_token_hash ${blob} NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_accessed_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arrival_shares_active
        ON arrival_plan_shares (flight_identifier, flight_date, is_active);
    `);
  }

  async getPreferences(input: JourneyKey): Promise<JourneyPreferences> {
    const key = normalizeKey(input);
    const row = await this.db.get<PreferencesRow>(
      `SELECT * FROM journey_preferences
       WHERE flight_identifier = ? AND flight_date = ?`,
      [key.flightIdentifier, key.flightDate],
    );
    return mapPreferences(row, key);
  }

  async upsertPreferences(
    input: JourneyKey,
    update: JourneyPreferencesUpdate,
  ): Promise<JourneyPreferences> {
    const key = normalizeKey(input);
    return this.db.transaction(async (tx) => {
      const store = new JourneyStore(tx);
      const current = await store.getPreferences(key);
      const now = new Date().toISOString();
      const values = {
        checkedBags:
          update.checkedBags === undefined ? current.checkedBags : update.checkedBags,
        departureSecurityLane:
          cleanOptionalText(update.departureSecurityLane) ??
          (update.departureSecurityLane === undefined ? current.departureSecurityLane : null),
        arrivalSeat:
          cleanOptionalText(update.arrivalSeat) ??
          (update.arrivalSeat === undefined ? current.arrivalSeat : null),
        arrivalSeatZone:
          cleanOptionalText(update.arrivalSeatZone) ??
          (update.arrivalSeatZone === undefined ? current.arrivalSeatZone : null),
        arrivalDestination:
          cleanOptionalText(update.arrivalDestination) ??
          (update.arrivalDestination === undefined ? current.arrivalDestination : null),
        immigrationLane:
          cleanOptionalText(update.immigrationLane) ??
          (update.immigrationLane === undefined ? current.immigrationLane : null),
      };

      await tx.run(
        `INSERT INTO journey_preferences (
          flight_identifier, flight_date, checked_bags, departure_security_lane,
          arrival_seat, arrival_seat_zone, arrival_destination, immigration_lane,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (flight_identifier, flight_date) DO UPDATE SET
          checked_bags = excluded.checked_bags,
          departure_security_lane = excluded.departure_security_lane,
          arrival_seat = excluded.arrival_seat,
          arrival_seat_zone = excluded.arrival_seat_zone,
          arrival_destination = excluded.arrival_destination,
          immigration_lane = excluded.immigration_lane,
          updated_at = excluded.updated_at`,
        [
          key.flightIdentifier,
          key.flightDate,
          values.checkedBags === null ? null : Number(values.checkedBags),
          values.departureSecurityLane,
          values.arrivalSeat,
          values.arrivalSeatZone,
          values.arrivalDestination,
          values.immigrationLane,
          current.createdAt ?? now,
          now,
        ],
      );
      return store.getPreferences(key);
    });
  }

  async addEvent(input: JourneyKey, event: AddJourneyEvent): Promise<JourneyEvent> {
    const key = normalizeKey(input);
    const rank = EVENT_RANK[event.eventType];
    if (!rank) throw new Error("Unknown journey event type");
    const source = event.source.trim();
    if (!source) throw new Error("Event source is required");

    return this.db.transaction(async (tx) => {
      const store = new JourneyStore(tx);
      await store.ensureJourney(key);
      const latest = await tx.get<{ event_rank: number | null }>(
        `SELECT MAX(event_rank) AS event_rank
         FROM passenger_journey_events
         WHERE flight_identifier = ? AND flight_date = ?`,
        [key.flightIdentifier, key.flightDate],
      );
      if (latest?.event_rank != null && rank <= latest.event_rank) {
        throw new Error("Journey events must be added in monotonic order");
      }

      const now = new Date().toISOString();
      const row: EventRow = {
        id: randomBytes(16).toString("hex"),
        flight_identifier: key.flightIdentifier,
        flight_date: key.flightDate,
        event_type: event.eventType,
        event_rank: rank,
        source,
        event_time: utcTimestamp(event.eventTime),
        corrected_at: null,
        created_at: now,
        updated_at: now,
      };
      await tx.run(
        `INSERT INTO passenger_journey_events (
          id, flight_identifier, flight_date, event_type, event_rank, source,
          event_time, corrected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.flight_identifier,
          row.flight_date,
          row.event_type,
          row.event_rank,
          row.source,
          row.event_time,
          row.corrected_at,
          row.created_at,
          row.updated_at,
        ],
      );
      return mapEvent(row);
    });
  }

  async listEvents(input: JourneyKey): Promise<JourneyEvent[]> {
    const key = normalizeKey(input);
    const rows = await this.db.all<EventRow>(
      `SELECT * FROM passenger_journey_events
       WHERE flight_identifier = ? AND flight_date = ?
       ORDER BY event_rank`,
      [key.flightIdentifier, key.flightDate],
    );
    return rows.map(mapEvent);
  }

  async resetEvents(input: JourneyKey, confirmed: boolean): Promise<number> {
    if (!confirmed) throw new Error("Journey event reset requires explicit confirmation");
    const key = normalizeKey(input);
    const result = await this.db.run(
      `DELETE FROM passenger_journey_events
       WHERE flight_identifier = ? AND flight_date = ?`,
      [key.flightIdentifier, key.flightDate],
    );
    return result.changes;
  }

  /**
   * Create a share, or reuse the active one. On reuse, plaintext tokens are not
   * recoverable from the DB (only hashes are stored). Callers that lost tokens
   * should revoke and create again via `forceNew`.
   */
  async createOrReuseShare(
    input: JourneyKey,
    options: { now?: Date; forceNew?: boolean } = {},
  ): Promise<CreateOrReuseShareResult> {
    const key = normalizeKey(input);
    const now = options.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const store = new JourneyStore(tx);
      await store.ensureJourney(key);
      const nowIso = utcTimestamp(now);
      await tx.run(
        `UPDATE arrival_plan_shares
         SET is_active = 0, updated_at = ?
         WHERE flight_identifier = ? AND flight_date = ?
           AND is_active = 1 AND expires_at <= ?`,
        [nowIso, key.flightIdentifier, key.flightDate, nowIso],
      );

      if (options.forceNew) {
        await tx.run(
          `UPDATE arrival_plan_shares
           SET is_active = 0, revoked_at = ?, updated_at = ?
           WHERE flight_identifier = ? AND flight_date = ? AND is_active = 1`,
          [nowIso, nowIso, key.flightIdentifier, key.flightDate],
        );
      } else {
        const existing = await tx.get<{ share_id: string; expires_at: string }>(
          `SELECT share_id, expires_at FROM arrival_plan_shares
           WHERE flight_identifier = ? AND flight_date = ? AND is_active = 1`,
          [key.flightIdentifier, key.flightDate],
        );
        if (existing) {
          return {
            status: "reused" as const,
            shareId: existing.share_id,
            expiresAt: existing.expires_at,
          };
        }
      }

      const shareId = `ap_${randomBytes(16).toString("base64url")}`;
      const publicToken = randomBytes(32).toString("base64url");
      const managementToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.valueOf() + SHARE_LIFETIME_MS).toISOString();
      await tx.run(
        `INSERT INTO arrival_plan_shares (
          share_id, flight_identifier, flight_date, public_token_hash,
          management_token_hash, expires_at, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          shareId,
          key.flightIdentifier,
          key.flightDate,
          tokenHash(publicToken),
          tokenHash(managementToken),
          expiresAt,
          nowIso,
          nowIso,
        ],
      );
      return {
        status: "created" as const,
        shareId,
        publicToken,
        managementToken,
        expiresAt,
      };
    });
  }

  async getPublicShare(
    shareId: string,
    publicToken: string,
    now = new Date(),
  ): Promise<PublicArrivalPlanShare | null> {
    const row = await this.getAuthorizedShare(shareId, publicToken, "public", now);
    if (!row) return null;
    const preferences = await this.getPreferences({
      flightIdentifier: row.flight_identifier,
      flightDate: row.flight_date,
    });
    return {
      shareId: row.share_id,
      flightIdentifier: row.flight_identifier,
      flightDate: row.flight_date,
      expiresAt: row.expires_at,
      lastAccessedAt: row.last_accessed_at,
      preferences: {
        checkedBags: preferences.checkedBags,
        departureSecurityLane: preferences.departureSecurityLane,
        arrivalSeatZone: preferences.arrivalSeatZone,
        arrivalDestination: preferences.arrivalDestination,
        immigrationLane: preferences.immigrationLane,
      },
      events: await this.listEvents(preferences),
    };
  }

  async touchShare(shareId: string, publicToken: string, now = new Date()): Promise<boolean> {
    const row = await this.getAuthorizedShare(shareId, publicToken, "public", now);
    if (!row) return false;
    const nowIso = utcTimestamp(now);
    const result = await this.db.run(
      `UPDATE arrival_plan_shares SET last_accessed_at = ?, updated_at = ?
       WHERE share_id = ? AND is_active = 1`,
      [nowIso, nowIso, shareId],
    );
    return result.changes === 1;
  }

  async revokeShare(shareId: string, managementToken: string, now = new Date()): Promise<boolean> {
    const row = await this.getAuthorizedShare(shareId, managementToken, "management", now);
    if (!row) return false;
    const nowIso = utcTimestamp(now);
    const result = await this.db.run(
      `UPDATE arrival_plan_shares
       SET revoked_at = ?, is_active = 0, updated_at = ?
       WHERE share_id = ? AND is_active = 1`,
      [nowIso, nowIso, shareId],
    );
    return result.changes === 1;
  }

  private async ensureJourney(key: JourneyKey): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO journey_preferences (
        flight_identifier, flight_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (flight_identifier, flight_date) DO NOTHING`,
      [key.flightIdentifier, key.flightDate, now, now],
    );
  }

  private async getAuthorizedShare(
    shareId: string,
    token: string,
    kind: "public" | "management",
    now: Date,
  ): Promise<ShareRow | null> {
    const row = await this.db.get<ShareRow>(
      `SELECT share_id, flight_identifier, flight_date, public_token_hash,
        management_token_hash, expires_at, revoked_at, last_accessed_at
       FROM arrival_plan_shares WHERE share_id = ? AND is_active = 1`,
      [shareId],
    );
    if (!row || row.revoked_at || row.expires_at <= utcTimestamp(now)) return null;
    const hash = kind === "public" ? row.public_token_hash : row.management_token_hash;
    return tokenMatches(token, hash) ? row : null;
  }
}
