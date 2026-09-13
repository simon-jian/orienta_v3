/**
 * WebRTC call signaling — parse + relay. SDP is never written to chat history.
 */
import type {
  CallCandidatePayload,
  CallEvent,
  CallEventType,
  CallMode,
  CallParty,
  CallSdpPayload,
} from "../../src/types/types";

export const CALL_EVENT_TYPES = new Set<CallEventType>([
  "call_invite",
  "call_accept",
  "call_reject",
  "call_hangup",
  "call_signal",
]);

const MAX_CALL_ID_LEN = 80;
const MAX_SDP_LEN = 48_000;
const MAX_CANDIDATE_LEN = 2_000;

export type CallRelayStore = {
  broadcastAdmins(tenantId: string, msg: unknown, excludeWs?: unknown): void;
  broadcastPax(tenantId: string, passengerId: string, msg: unknown, excludeWs?: unknown): void;
};

function parseSdp(raw: unknown): CallSdpPayload | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const type = obj.type === "offer" || obj.type === "answer" ? obj.type : null;
  const sdp = typeof obj.sdp === "string" ? obj.sdp : "";
  if (!type || !sdp || sdp.length > MAX_SDP_LEN) return undefined;
  return { type, sdp };
}

function parseCandidate(raw: unknown): CallCandidatePayload | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const candidate = typeof obj.candidate === "string" ? obj.candidate : "";
  if (!candidate || candidate.length > MAX_CANDIDATE_LEN) return undefined;
  const out: CallCandidatePayload = { candidate };
  if (typeof obj.sdpMid === "string" || obj.sdpMid === null) out.sdpMid = obj.sdpMid;
  if (typeof obj.sdpMLineIndex === "number" && Number.isFinite(obj.sdpMLineIndex)) {
    out.sdpMLineIndex = obj.sdpMLineIndex;
  }
  return out;
}

/**
 * Returns a sanitized call payload, or null when the frame should be dropped.
 */
export function parseCallMessage(msg: Record<string, unknown>): Omit<CallEvent, "passengerId"> & { passengerId?: string } | null {
  const type = msg.type;
  if (typeof type !== "string" || !CALL_EVENT_TYPES.has(type as CallEventType)) return null;

  const callId = typeof msg.callId === "string" ? msg.callId.trim() : "";
  if (!callId || callId.length > MAX_CALL_ID_LEN) return null;

  const passengerId = typeof msg.passengerId === "string" ? msg.passengerId.trim() : "";
  const from: CallParty | undefined = msg.from === "admin" || msg.from === "pax" ? msg.from : undefined;

  if (type === "call_invite") {
    const mode: CallMode | null = msg.mode === "audio" || msg.mode === "video" ? msg.mode : null;
    if (!mode || !from) return null;
    return { type, callId, passengerId: passengerId || undefined, mode, from };
  }

  if (type === "call_signal") {
    const sdp = parseSdp(msg.sdp);
    const candidate = parseCandidate(msg.candidate);
    if (!sdp && !candidate) return null;
    return { type, callId, passengerId: passengerId || undefined, from, sdp, candidate };
  }

  return { type: type as CallEventType, callId, passengerId: passengerId || undefined, from };
}

export function resolveCallPassengerId(
  role: "admin" | "pax",
  sessionPassengerId: string | null | undefined,
  messagePassengerId: string | undefined,
): string | null {
  if (role === "pax") {
    const pid = String(sessionPassengerId || "").trim();
    if (!pid) return null;
    if (messagePassengerId && messagePassengerId !== pid) return null;
    return pid;
  }
  const pid = String(messagePassengerId || "").trim();
  return pid || null;
}

/**
 * Relays a parsed call_* frame to the matching passenger and tenant admins.
 * Returns false when the payload is dropped.
 */
export function relayCallMessage(
  store: CallRelayStore,
  args: {
    role: "admin" | "pax";
    tenantId: string;
    sessionPassengerId?: string | null;
    msg: Record<string, unknown>;
    excludeWs?: unknown;
  },
): boolean {
  const parsed = parseCallMessage(args.msg);
  if (!parsed) return false;
  const passengerId = resolveCallPassengerId(args.role, args.sessionPassengerId, parsed.passengerId);
  if (!passengerId || !args.tenantId) return false;

  const outbound: CallEvent & { tenantId: string } = {
    ...parsed,
    passengerId,
    tenantId: args.tenantId,
    from: parsed.from ?? args.role,
  };

  // Never echo the sender's own frame back — a pax offer/ICE loop used to
  // apply as remote SDP and tear the call down the instant the peer accepted.
  store.broadcastPax(args.tenantId, passengerId, outbound, args.excludeWs);
  store.broadcastAdmins(args.tenantId, outbound, args.excludeWs);
  return true;
}
