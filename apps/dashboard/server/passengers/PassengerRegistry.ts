/**
 * PassengerRegistry — SQLite-backed passenger store.
 *
 * Source of truth for passenger profiles. Replaces the hardcoded
 * PEK_PROFILES + PEK_SCENARIOS arrays. Passengers are created on-demand
 * when they first connect via WebSocket (hello handler) or pre-registered
 * via the admin REST API.
 *
 * Schema keeps static profile columns separate from dynamic sim state
 * (activity, ext_status, location) so operators can override status
 * without disrupting the running simulation.
 */
import type { SqlDb } from "../db/sqlDb";
import { getGateCoord, getPekCenter, getPekBbox } from "../lib/poiCache";
import { airportForTenant } from "../../src/config/tenants/registry";
import { getAirportOrDefault } from "../../src/config/airports/registry";

const DEFAULT_SPAWN_RADIUS_M = 400;

// Field length caps enforced at the registry boundary — routes only coerce to
// string, they don't bound length, so an oversized value from a WS hello or
// admin API call would otherwise be stored (and later re-rendered) as-is.
const MAX_NAME_LEN = 200;
const MAX_NATIONALITY_LEN = 100;
const MAX_LOCALE_LEN = 20;
const MAX_FLIGHT_ID_LEN = 20;
const MAX_GATE_ID_LEN = 20;
const MAX_AIRPORT_LABEL_LEN = 100;

function clampLen(value: string | undefined, maxLen: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, maxLen);
}

function randomNearby(center: { lat: number; lng: number }, maxM: number) {
  const dLat = (maxM / 111000) * (Math.random() * 2 - 1);
  const dLng = (maxM / (111000 * Math.cos((center.lat * Math.PI) / 180))) * (Math.random() * 2 - 1);
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

function clampToBbox(
  p: { lat: number; lng: number },
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
) {
  return {
    lat: Math.max(bbox.minLat, Math.min(bbox.maxLat, p.lat)),
    lng: Math.max(bbox.minLng, Math.min(bbox.maxLng, p.lng)),
  };
}
import type {
  Passenger, PaxExtStatus, PassengerActivity, PaxPlan, PaxPresenceBehavior,
} from "../../src/types/types";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Full passenger record as stored in the database + online state. */
export type PassengerRecord = Passenger & {
  tenantId: string;
  source: "qr_scan" | "phone_bcbp" | "manual" | "api_import" | "account_login";
  createdAt: number;
  lastSeenAt?: number;
  isOnline: boolean;
};

/** Input for creating a new passenger. `flightId` and `gateId` are required. */
export type CreatePassengerInput = {
  id: string;
  tenantId: string;
  name?: string;
  nationality?: string;
  locale?: string;
  needsWheelchair?: boolean;
  plan?: PaxPlan;
  flightId: string;
  gateId: string;
  inboundFlightId?: string;
  inboundFrom?: string;
  outboundTo?: string;
  source?: PassengerRecord["source"];
};

/** Allowed fields for PATCH updates from the admin UI. */
export type PassengerPatch = Partial<Pick<
  PassengerRecord,
  | "name" | "nationality" | "locale" | "needsWheelchair" | "plan"
  | "flightId" | "gateId" | "extStatus" | "activity"
  | "isOnline" | "lastSeenAt"
>>;

// ─── PassengerRegistry ────────────────────────────────────────────────────────

export class PassengerRegistry {
  constructor(private readonly db: SqlDb) {}

  // ── Schema ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS passengers (
        id              TEXT    NOT NULL,
        tenant_id       TEXT    NOT NULL,
        name            TEXT    NOT NULL DEFAULT 'Unknown',
        nationality     TEXT    NOT NULL DEFAULT '',
        locale          TEXT    NOT NULL DEFAULT 'en-US',
        needs_wheelchair INTEGER NOT NULL DEFAULT 0,
        plan            TEXT    NOT NULL DEFAULT 'free',
        flight_id       TEXT    NOT NULL DEFAULT '',
        gate_id         TEXT    NOT NULL DEFAULT '',
        inbound_flight  TEXT,
        inbound_from    TEXT,
        outbound_to     TEXT,
        activity        TEXT    NOT NULL DEFAULT 'moving',
        ext_status      TEXT    NOT NULL DEFAULT 'green',
        location_lat    REAL    NOT NULL DEFAULT 0,
        location_lng    REAL    NOT NULL DEFAULT 0,
        source          TEXT    NOT NULL DEFAULT 'qr_scan',
        created_at      BIGINT  NOT NULL,
        last_seen_at    BIGINT,
        is_online       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, tenant_id)
      );
    `);
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_passengers_tenant_created ON passengers (tenant_id, created_at);",
    );
  }

  // ── Core CRUD ───────────────────────────────────────────────────────────────

  /**
   * Return existing passenger or create from input.
   * Safe to call on every WS hello — concurrent calls for the same id (e.g.
   * two tabs/devices reconnecting at once) resolve to the same row rather
   * than racing on a check-then-insert (the INSERT is `ON CONFLICT DO
   * NOTHING`, so a losing concurrent caller gets a no-op instead of a
   * primary-key-violation exception).
   */
  async getOrCreate(input: CreatePassengerInput): Promise<PassengerRecord> {
    await this.upsertIgnoringConflict(input);
    const record = await this.get(input.tenantId, input.id);
    if (!record) {
      throw new Error(`getOrCreate: passenger ${input.tenantId}/${input.id} missing immediately after upsert`);
    }
    return record;
  }

  async get(tenantId: string, passengerId: string): Promise<PassengerRecord | null> {
    const row = await this.db.get<DbRow>(
      "SELECT * FROM passengers WHERE id = ? AND tenant_id = ?",
      [passengerId, tenantId],
    );
    return row ? rowToRecord(row) : null;
  }

  async list(tenantId: string): Promise<PassengerRecord[]> {
    const rows = await this.db.all<DbRow>(
      "SELECT * FROM passengers WHERE tenant_id = ? ORDER BY created_at ASC",
      [tenantId],
    );
    return rows.map(rowToRecord);
  }

  async update(tenantId: string, passengerId: string, patch: PassengerPatch): Promise<PassengerRecord | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (patch.name            !== undefined) { sets.push("name = ?");             vals.push(clampLen(patch.name, MAX_NAME_LEN)); }
    if (patch.nationality     !== undefined) { sets.push("nationality = ?");      vals.push(clampLen(patch.nationality, MAX_NATIONALITY_LEN)); }
    if (patch.locale          !== undefined) { sets.push("locale = ?");           vals.push(clampLen(patch.locale, MAX_LOCALE_LEN)); }
    if (patch.needsWheelchair !== undefined) { sets.push("needs_wheelchair = ?"); vals.push(patch.needsWheelchair ? 1 : 0); }
    if (patch.plan            !== undefined) { sets.push("plan = ?");             vals.push(patch.plan); }
    if (patch.flightId        !== undefined) { sets.push("flight_id = ?");        vals.push(clampLen(patch.flightId, MAX_FLIGHT_ID_LEN)); }
    if (patch.gateId          !== undefined) { sets.push("gate_id = ?");          vals.push(clampLen(patch.gateId, MAX_GATE_ID_LEN)); }
    if (patch.extStatus       !== undefined) { sets.push("ext_status = ?");       vals.push(patch.extStatus); }
    if (patch.activity        !== undefined) { sets.push("activity = ?");         vals.push(patch.activity); }
    if (patch.isOnline        !== undefined) { sets.push("is_online = ?");        vals.push(patch.isOnline ? 1 : 0); }
    if (patch.lastSeenAt      !== undefined) { sets.push("last_seen_at = ?");     vals.push(patch.lastSeenAt); }

    if (sets.length === 0) return this.get(tenantId, passengerId);

    vals.push(passengerId, tenantId);
    await this.db.run(
      `UPDATE passengers SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      vals,
    );

    return this.get(tenantId, passengerId);
  }

  async delete(tenantId: string, passengerId: string): Promise<boolean> {
    const r = await this.db.run(
      "DELETE FROM passengers WHERE id = ? AND tenant_id = ?",
      [passengerId, tenantId],
    );
    return r.changes > 0;
  }

  // ── Online state helpers ─────────────────────────────────────────────────────

  async markOnline(tenantId: string, passengerId: string): Promise<void> {
    await this.db.run(
      "UPDATE passengers SET is_online = 1, last_seen_at = ? WHERE id = ? AND tenant_id = ?",
      [Date.now(), passengerId, tenantId],
    );
  }

  async markOffline(tenantId: string, passengerId: string): Promise<void> {
    await this.db.run(
      "UPDATE passengers SET is_online = 0, last_seen_at = ? WHERE id = ? AND tenant_id = ?",
      [Date.now(), passengerId, tenantId],
    );
  }

  /** Removes offline temporary passengers older than maxAgeMs. */
  async deleteStaleTemporaryPassengers(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const r = await this.db.run(
      `DELETE FROM passengers
       WHERE is_online = 0
         AND (id LIKE 'TMP_%' OR id LIKE 'BASIC_%')
         AND COALESCE(last_seen_at, created_at) < ?`,
      [cutoff],
    );
    return r.changes;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Insert a new passenger row, silently doing nothing if one with the same
   * (id, tenant_id) already exists — the caller (getOrCreate) re-selects
   * afterward either way, so this never needs to distinguish "inserted" from
   * "already there".
   */
  private async upsertIgnoringConflict(input: CreatePassengerInput): Promise<void> {
    // Derive spawn location near the destination gate
    const gateEntry = getGateCoord(input.gateId);
    const gateCoord = gateEntry
      ? { lat: gateEntry[0], lng: gateEntry[1] }
      : getPekCenter();
    const bbox = getPekBbox();
    const spawnRadiusM = getAirportOrDefault(airportForTenant(input.tenantId)).poi.spawnRadiusM ?? DEFAULT_SPAWN_RADIUS_M;
    const location = clampToBbox(randomNearby(gateCoord, spawnRadiusM), bbox);

    const now = Date.now();
    await this.db.run(
      `INSERT INTO passengers (
        id, tenant_id, name, nationality, locale, needs_wheelchair,
        plan, flight_id, gate_id, inbound_flight, inbound_from, outbound_to,
        activity, ext_status,
        location_lat, location_lng,
        source, created_at, is_online
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id, tenant_id) DO NOTHING`,
      [
        input.id,
        input.tenantId,
        clampLen(input.name, MAX_NAME_LEN) ?? "Unknown",
        clampLen(input.nationality, MAX_NATIONALITY_LEN) ?? "",
        clampLen(input.locale, MAX_LOCALE_LEN) ?? "en-US",
        input.needsWheelchair ? 1 : 0,
        input.plan ?? "free",
        clampLen(input.flightId, MAX_FLIGHT_ID_LEN),
        clampLen(input.gateId, MAX_GATE_ID_LEN),
        clampLen(input.inboundFlightId, MAX_FLIGHT_ID_LEN) ?? null,
        clampLen(input.inboundFrom, MAX_AIRPORT_LABEL_LEN) ?? null,
        clampLen(input.outboundTo, MAX_AIRPORT_LABEL_LEN) ?? null,
        "moving",
        "green",
        location.lat,
        location.lng,
        input.source ?? "qr_scan",
        now,
        1, // created on connect → online immediately
      ],
    );
  }
}

// ─── Row → Record conversion ──────────────────────────────────────────────────

type DbRow = {
  id: string; tenant_id: string;
  name: string; nationality: string; locale: string; needs_wheelchair: number;
  plan: string; flight_id: string; gate_id: string;
  inbound_flight: string | null; inbound_from: string | null; outbound_to: string | null;
  activity: string; ext_status: string;
  location_lat: number; location_lng: number;
  source: string; created_at: number; last_seen_at: number | null; is_online: number;
};

function rowToRecord(row: DbRow): PassengerRecord {
  const now = Date.now();
  return {
    // Passenger fields
    id: row.id,
    name: row.name,
    nationality: row.nationality,
    locale: row.locale,
    needsWheelchair: row.needs_wheelchair === 1,
    plan: row.plan as PaxPlan,
    flightId: row.flight_id,
    gateId: row.gate_id,
    activity: row.activity as PassengerActivity,
    extStatus: row.ext_status as PaxExtStatus,
    location: { lat: row.location_lat, lng: row.location_lng },
    presenceBehavior: "default" as PaxPresenceBehavior,
    sortPriority: 99,
    transfer: {
      direction: "intl_to_intl",
      urgency: "normal",
      inboundFlight:  row.inbound_flight ?? "—",
      inboundFrom:    row.inbound_from   ?? "—",
      inboundArr:     new Date(now - 60 * 60_000).toISOString(),  // default: 1h ago
      outboundFlight: row.flight_id,
      outboundTo:     row.outbound_to    ?? "—",
      outboundDep:    new Date(now + 40 * 60_000).toISOString(),  // filled in by API from flight data
    },
    // Registry-only fields
    tenantId: row.tenant_id,
    source: row.source as PassengerRecord["source"],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    isOnline: row.is_online === 1,
  };
}
