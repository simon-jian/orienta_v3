/**
 * Single source of truth for all shared types.
 *
 * Previously split across three files with silent divergence:
 *   - src/services/types.ts
 *   - src/services/realtime.ts
 *   - vite/wsHub.ts
 *
 * Server code (server/) imports directly from this file too.
 */

// ─── Geo ─────────────────────────────────────────────────────────────────────

export type LatLng = { lat: number; lng: number };

// ─── Airport entities ────────────────────────────────────────────────────────

export type Gate = {
  id: string;
  name: string;
  coordinate: LatLng;
  tags?: Record<string, string>;
};

export type Flight = {
  id: string;
  callsign: string;
  destination: string;
  scheduledDep: string; // ISO-8601
  status: "Gate Open" | "Boarding" | "Final Call" | "Closed" | "Delayed";
  gateRef?: string;
  gateId?: string;
};

// ─── Passengers ──────────────────────────────────────────────────────────────

export type PassengerActivity =
  | "moving"
  | "shopping"
  | "dining"
  | "idle"
  | "at_gate"
  | "boarded"
  | "lounge";

export type TransferDirection = "intl_to_intl" | "intl_to_dom" | "dom_to_intl" | "dom_to_dom";

export type TransferInfo = {
  direction: TransferDirection;
  urgency: "urgent" | "normal";
  inboundFlight: string;
  inboundFrom: string;
  inboundArr: string; // ISO-8601
  outboundFlight: string;
  outboundTo: string;
  outboundDep: string; // ISO-8601
  note?: string;
};

export type PaxExtStatus =
  | "green"
  | "yellow"
  | "red"
  | "missed"
  | "offline"
  | "lost"
  | "gray";

export type PaxPlan = "premium" | "free";

/**
 * Encodes special demo behaviours per-passenger as data fields,
 * replacing the old pattern of hardcoding passenger IDs (P8, P11, TX3)
 * directly in render/sort logic.
 */
export type PaxPresenceBehavior =
  | "default"
  | "lost_when_offline";   // P8-style: show as "lost" when not connected

export type Passenger = {
  id: string;
  name: string;
  nationality: string;
  locale: string;
  needsWheelchair: boolean;
  plan: PaxPlan;
  transfer: TransferInfo;
  flightId: string;
  gateId: string;
  activity: PassengerActivity;
  location: LatLng;
  path?: LatLng[];
  pathIndex?: number;
  lastUpdateMs?: number;
  extStatus: PaxExtStatus;
  locationLostAt?: number;
  /** When set, sidebar shows this label instead of the static sim gate hint. */
  liveVideoGateHint?: string;
  /** Encodes special display/sort behaviour without hardcoding IDs in render logic. */
  presenceBehavior?: PaxPresenceBehavior;
  /** Passengers with lower sortPriority appear first in priority lists. */
  sortPriority?: number;
};

export type PassengerStatus = "green" | "yellow" | "red" | "gray";

export type PassengerComputed = Passenger & {
  etaMinutes: number | null;
  status: PassengerStatus;
  reason: string;
  /** True when passenger has an active WebSocket connection or live trajectory. */
  rtOnline?: boolean;
};

export type GateStats = {
  total: number;
  boarded: number;
  enRoute: number;
  notMoving: number;
  atGateWaiting: number;
};

// ─── Messaging ───────────────────────────────────────────────────────────────

/** One-way push notification (admin → pax, requires ack). */
export type MsgStatus = "sent" | "delivered" | "ack";

export type MsgRecord = {
  messageId: string;
  tenantId: string;
  passengerId: string;
  title: string;
  body: string;
  createdAt: number;
  deliveredAt?: number;
  ackAt?: number;
  status: MsgStatus;
};

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ChatKind = "text" | "location" | "system" | "ai_agent" | "operator";

/** Client-side delivery status for messages sent by admin. */
export type ChatMsgStatus = "sending" | "sent" | "delivered" | "read";

/**
 * Canonical ChatMessage definition — merged from the three diverged copies.
 * `status`, `deliveredAt`, `readAt` are only meaningful when `from === "admin"`.
 */
export type ChatMessage = {
  id: string;
  passengerId: string;
  tenantId: string;
  from: "admin" | "pax" | "system" | "agent";
  kind: ChatKind;
  body: string;
  gateRef?: string;
  createdAt: number;
  status?: ChatMsgStatus;
  deliveredAt?: number;
  readAt?: number;
};

// ─── Realtime events ─────────────────────────────────────────────────────────

export type PresenceEvent = {
  tenantId: string;
  passengerId: string;
  online: boolean;
  at: number;
};

export type MsgStatusEvent = {
  tenantId: string;
  passengerId: string;
  messageId: string;
  status: MsgStatus;
  createdAt: number;
  deliveredAt?: number;
  ackAt?: number;
};

export type PaxTrajectoryData = {
  path: LatLng[];
  position: LatLng;
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export type AdminSession = {
  exp: number;
  user: {
    email: string;
    displayName: string;
    org: string;
    role: "admin" | "ops" | "viewer";
  };
};
