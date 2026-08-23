/**
 * PaxInviteStore — one-time, device-bound passenger invite links.
 *
 * The back office issues a link per passenger (UUID + flight supplied by the
 * airline). The first device to open it binds itself to the invite; every
 * later redemption must present the same device id or is refused. Only the
 * SHA-256 of the link secret and of the device id are stored, so a database
 * leak yields neither a usable link nor a way to impersonate the device.
 *
 * Binding is trust-on-first-use: browsers cannot expose a hardware serial, so
 * the "device id" is a random UUID the client generates once and keeps in
 * localStorage. That defeats link forwarding (the intended threat) but not a
 * determined owner copying their own id, and it is lost when site data is
 * cleared — hence `resetDevice()` for the support desk.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SqlDb } from "../db/sqlDb";
import type { DeviceSummary } from "../lib/deviceSummary";

/** Which leg of the itinerary this invite is about. */
export type InviteLeg = "inbound" | "outbound";

/** Flight details captured at issue time and refreshed on each redemption. */
export type InviteFlightSnapshot = {
  depIata: string;
  arrIata: string;
  depTerminal: string;
  depGate: string;
  arrTerminal: string;
  arrGate: string;
  scheduledDepUtc: string | null;
  scheduledArrUtc: string | null;
  status: string;
};

export type PaxInvite = {
  inviteId: string;
  tenantId: string;
  passengerId: string;
  passengerName: string;
  flightId: string;
  flightDate: string;
  leg: InviteLeg;
  flight: InviteFlightSnapshot;
  /** True once a device has claimed this invite. The hash itself is never exposed. */
  deviceBound: boolean;
  deviceBoundAt: number | null;
  /** Coarse description of the bound device, for the support desk. Null until bound. */
  device: DeviceSummary | null;
  expiresAt: number;
  revokedAt: number | null;
  isActive: boolean;
  firstRedeemedAt: number | null;
  lastSeenAt: number | null;
  redeemCount: number;
  createdBy: string;
  createdAt: number;
};

export type CreateInviteInput = {
  tenantId: string;
  passengerId: string;
  passengerName?: string;
  flightId: string;
  flightDate: string;
  leg: InviteLeg;
  flight?: Partial<InviteFlightSnapshot>;
  expiresAt: number;
  createdBy: string;
};

export type RedeemFailureReason =
  | "not_found"
  | "invalid_token"
  | "revoked"
  | "expired"
  | "device_mismatch";

export type RedeemResult =
  | { ok: true; invite: PaxInvite; boundNow: boolean }
  | { ok: false; reason: RedeemFailureReason };

/** Long enough that the DB never truncates a legitimate UUID, short enough to bound abuse. */
const MAX_DEVICE_ID_LEN = 200;
const MAX_NAME_LEN = 200;

const EMPTY_SNAPSHOT: InviteFlightSnapshot = {
  depIata: "",
  arrIata: "",
  depTerminal: "",
  depGate: "",
  arrTerminal: "",
  arrGate: "",
  scheduledDepUtc: null,
  scheduledArrUtc: null,
  status: "",
};

type InviteRow = {
  invite_id: string;
  tenant_id: string;
  passenger_id: string;
  passenger_name: string;
  flight_id: string;
  flight_date: string;
  leg: string;
  token_hash: Buffer | string;
  dep_iata: string;
  arr_iata: string;
  dep_terminal: string;
  dep_gate: string;
  arr_terminal: string;
  arr_gate: string;
  scheduled_dep_utc: string | null;
  scheduled_arr_utc: string | null;
  flight_status: string;
  device_hash: Buffer | string | null;
  device_bound_at: number | null;
  device_os: string | null;
  device_os_version: string | null;
  device_browser: string | null;
  device_is_mobile: number | null;
  expires_at: number;
  revoked_at: number | null;
  is_active: number;
  first_redeemed_at: number | null;
  last_seen_at: number | null;
  redeem_count: number;
  created_by: string;
  created_at: number;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Postgres hands back BYTEA as a hex string (`\x…`) rather than a Buffer. */
function asBuffer(value: Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return Buffer.from(value, "binary");
}

function hashMatches(plain: string, expected: Buffer | string): boolean {
  const actual = sha256(plain);
  const want = asBuffer(expected);
  return actual.length === want.length && timingSafeEqual(actual, want);
}

function mapRow(row: InviteRow): PaxInvite {
  return {
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    flightId: row.flight_id,
    flightDate: row.flight_date,
    leg: row.leg === "inbound" ? "inbound" : "outbound",
    flight: {
      depIata: row.dep_iata,
      arrIata: row.arr_iata,
      depTerminal: row.dep_terminal,
      depGate: row.dep_gate,
      arrTerminal: row.arr_terminal,
      arrGate: row.arr_gate,
      scheduledDepUtc: row.scheduled_dep_utc,
      scheduledArrUtc: row.scheduled_arr_utc,
      status: row.flight_status,
    },
    deviceBound: row.device_hash !== null && row.device_hash !== undefined,
    deviceBoundAt: row.device_bound_at,
    device:
      row.device_os || row.device_browser
        ? {
            os: row.device_os || "",
            osVersion: row.device_os_version || "",
            browser: row.device_browser || "",
            isMobile: row.device_is_mobile === 1,
          }
        : null,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    isActive: row.is_active === 1,
    firstRedeemedAt: row.first_redeemed_at,
    lastSeenAt: row.last_seen_at,
    redeemCount: row.redeem_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class PaxInviteStore {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    const blob = this.db.dialect === "pg" ? "BYTEA" : "BLOB";
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS pax_invites (
        invite_id         TEXT    NOT NULL PRIMARY KEY,
        tenant_id         TEXT    NOT NULL,
        passenger_id      TEXT    NOT NULL,
        passenger_name    TEXT    NOT NULL DEFAULT '',
        flight_id         TEXT    NOT NULL,
        flight_date       TEXT    NOT NULL,
        leg               TEXT    NOT NULL DEFAULT 'outbound',
        token_hash        ${blob} NOT NULL,
        dep_iata          TEXT    NOT NULL DEFAULT '',
        arr_iata          TEXT    NOT NULL DEFAULT '',
        dep_terminal      TEXT    NOT NULL DEFAULT '',
        dep_gate          TEXT    NOT NULL DEFAULT '',
        arr_terminal      TEXT    NOT NULL DEFAULT '',
        arr_gate          TEXT    NOT NULL DEFAULT '',
        scheduled_dep_utc TEXT,
        scheduled_arr_utc TEXT,
        flight_status     TEXT    NOT NULL DEFAULT '',
        device_hash       ${blob},
        device_bound_at   BIGINT,
        device_os         TEXT,
        device_os_version TEXT,
        device_browser    TEXT,
        device_is_mobile  INTEGER,
        expires_at        BIGINT  NOT NULL,
        revoked_at        BIGINT,
        is_active         INTEGER NOT NULL DEFAULT 1,
        first_redeemed_at BIGINT,
        last_seen_at      BIGINT,
        redeem_count      INTEGER NOT NULL DEFAULT 0,
        created_by        TEXT    NOT NULL DEFAULT '',
        created_at        BIGINT  NOT NULL
      );
    `);
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_pax_invites_tenant_created ON pax_invites (tenant_id, created_at);",
    );
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_pax_invites_passenger ON pax_invites (tenant_id, passenger_id);",
    );
  }

  /**
   * Issue a new invite. The returned `token` is the only time the secret
   * exists outside the caller's response — the row keeps just its hash.
   */
  async create(input: CreateInviteInput): Promise<{ invite: PaxInvite; token: string }> {
    const inviteId = `inv_${randomBytes(16).toString("base64url")}`;
    const token = randomBytes(32).toString("base64url");
    const snapshot = { ...EMPTY_SNAPSHOT, ...(input.flight ?? {}) };
    const now = Date.now();

    await this.db.run(
      `INSERT INTO pax_invites (
         invite_id, tenant_id, passenger_id, passenger_name, flight_id, flight_date, leg,
         token_hash, dep_iata, arr_iata, dep_terminal, dep_gate, arr_terminal, arr_gate,
         scheduled_dep_utc, scheduled_arr_utc, flight_status,
         expires_at, is_active, redeem_count, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [
        inviteId,
        input.tenantId,
        input.passengerId,
        (input.passengerName ?? "").slice(0, MAX_NAME_LEN),
        input.flightId,
        input.flightDate,
        input.leg,
        sha256(token),
        snapshot.depIata,
        snapshot.arrIata,
        snapshot.depTerminal,
        snapshot.depGate,
        snapshot.arrTerminal,
        snapshot.arrGate,
        snapshot.scheduledDepUtc,
        snapshot.scheduledArrUtc,
        snapshot.status,
        input.expiresAt,
        input.createdBy,
        now,
      ],
    );

    const invite = await this.get(inviteId);
    if (!invite) throw new Error("invite_insert_failed");
    return { invite, token };
  }

  async get(inviteId: string): Promise<PaxInvite | null> {
    const row = await this.db.get<InviteRow>("SELECT * FROM pax_invites WHERE invite_id = ?", [inviteId]);
    return row ? mapRow(row) : null;
  }

  async list(tenantId: string): Promise<PaxInvite[]> {
    const rows = await this.db.all<InviteRow>(
      "SELECT * FROM pax_invites WHERE tenant_id = ? ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map(mapRow);
  }

  /**
   * Validate the link secret and enforce the device binding.
   *
   * The bind is a conditional UPDATE rather than read-then-write so that two
   * devices opening the same fresh link at once cannot both succeed: exactly
   * one UPDATE matches `device_hash IS NULL`, and the loser falls through to
   * the mismatch comparison.
   */
  async redeem(
    inviteId: string,
    token: string,
    deviceId: string,
    deviceInfo?: DeviceSummary,
  ): Promise<RedeemResult> {
    const row = await this.db.get<InviteRow>("SELECT * FROM pax_invites WHERE invite_id = ?", [inviteId]);
    if (!row) return { ok: false, reason: "not_found" };
    if (!hashMatches(token, row.token_hash)) return { ok: false, reason: "invalid_token" };
    if (row.is_active !== 1 || row.revoked_at !== null) return { ok: false, reason: "revoked" };

    const now = Date.now();
    if (now >= row.expires_at) return { ok: false, reason: "expired" };

    const device = deviceId.slice(0, MAX_DEVICE_ID_LEN);
    const deviceHash = sha256(device);
    let boundNow = false;

    if (row.device_hash === null || row.device_hash === undefined) {
      const claimed = await this.db.run(
        "UPDATE pax_invites SET device_hash = ?, device_bound_at = ? WHERE invite_id = ? AND device_hash IS NULL",
        [deviceHash, now, inviteId],
      );
      boundNow = claimed.changes > 0;
      if (!boundNow) {
        const current = await this.db.get<InviteRow>(
          "SELECT device_hash FROM pax_invites WHERE invite_id = ?",
          [inviteId],
        );
        if (!current?.device_hash || !hashMatches(device, current.device_hash)) {
          return { ok: false, reason: "device_mismatch" };
        }
      }
    } else if (!hashMatches(device, row.device_hash)) {
      return { ok: false, reason: "device_mismatch" };
    }

    // The device description is refreshed on every redemption, not just the
    // first: the binding is fixed, but the phone's OS gets updated, and what the
    // desk needs is what the passenger is holding now.
    await this.db.run(
      `UPDATE pax_invites
         SET redeem_count = redeem_count + 1,
             last_seen_at = ?,
             first_redeemed_at = COALESCE(first_redeemed_at, ?),
             device_os = COALESCE(?, device_os),
             device_os_version = COALESCE(?, device_os_version),
             device_browser = COALESCE(?, device_browser),
             device_is_mobile = COALESCE(?, device_is_mobile)
       WHERE invite_id = ?`,
      [
        now,
        now,
        deviceInfo?.os || null,
        deviceInfo?.osVersion || null,
        deviceInfo?.browser || null,
        deviceInfo ? (deviceInfo.isMobile ? 1 : 0) : null,
        inviteId,
      ],
    );

    const invite = await this.get(inviteId);
    if (!invite) return { ok: false, reason: "not_found" };
    return { ok: true, invite, boundNow };
  }

  /** Overwrite the cached flight details, e.g. after a live re-lookup on redeem. */
  async updateFlightSnapshot(inviteId: string, snapshot: InviteFlightSnapshot): Promise<void> {
    await this.db.run(
      `UPDATE pax_invites
         SET dep_iata = ?, arr_iata = ?, dep_terminal = ?, dep_gate = ?,
             arr_terminal = ?, arr_gate = ?, scheduled_dep_utc = ?,
             scheduled_arr_utc = ?, flight_status = ?
       WHERE invite_id = ?`,
      [
        snapshot.depIata,
        snapshot.arrIata,
        snapshot.depTerminal,
        snapshot.depGate,
        snapshot.arrTerminal,
        snapshot.arrGate,
        snapshot.scheduledDepUtc,
        snapshot.scheduledArrUtc,
        snapshot.status,
        inviteId,
      ],
    );
  }

  async revoke(inviteId: string): Promise<boolean> {
    const result = await this.db.run(
      "UPDATE pax_invites SET is_active = 0, revoked_at = ? WHERE invite_id = ? AND is_active = 1",
      [Date.now(), inviteId],
    );
    return result.changes > 0;
  }

  /** Hard-delete the row. Revoke keeps the record; this removes it from the list. */
  async remove(inviteId: string): Promise<boolean> {
    const result = await this.db.run("DELETE FROM pax_invites WHERE invite_id = ?", [inviteId]);
    return result.changes > 0;
  }

  /**
   * Drop every invite belonging to one passenger. Part of erasing the
   * passenger: the rows hold their name, and — because redeeming an invite
   * re-creates the registry record — a surviving active link would let the
   * passenger walk back in and silently undo the deletion.
   */
  async removeAllForPassenger(tenantId: string, passengerId: string): Promise<number> {
    const result = await this.db.run(
      "DELETE FROM pax_invites WHERE tenant_id = ? AND passenger_id = ?",
      [tenantId, passengerId],
    );
    return result.changes;
  }

  async countForPassenger(tenantId: string, passengerId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pax_invites WHERE tenant_id = ? AND passenger_id = ?",
      [tenantId, passengerId],
    );
    return Number(row?.n ?? 0);
  }

  /** Revoked, or past `expiresAt`. Active unexpired invites are left alone. */
  async listInactive(tenantId: string, nowMs = Date.now()): Promise<PaxInvite[]> {
    const rows = await this.db.all<InviteRow>(
      `SELECT * FROM pax_invites
        WHERE tenant_id = ?
          AND (is_active = 0 OR revoked_at IS NOT NULL OR expires_at <= ?)
        ORDER BY created_at DESC`,
      [tenantId, nowMs],
    );
    return rows.map(mapRow);
  }

  /** Clear the binding so the passenger can claim the link from a new device. */
  async resetDevice(inviteId: string): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE pax_invites
         SET device_hash = NULL, device_bound_at = NULL,
             device_os = NULL, device_os_version = NULL,
             device_browser = NULL, device_is_mobile = NULL
       WHERE invite_id = ?`,
      [inviteId],
    );
    return result.changes > 0;
  }
}
