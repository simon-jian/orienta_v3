/**
 * WebSocket realtime service — types now come from the canonical types/index.
 *
 * Updated imports: all shared types imported from ../types/index.
 */
import type {
  MsgRecord, MsgStatus, MsgStatusEvent, ChatMessage, ChatKind,
  PresenceEvent, PaxTrajectoryData, CallEvent, CallEventType,
} from "../types/types";
import { wsUrl } from "../config/api";

const CALL_EVENT_TYPES = new Set<CallEventType>([
  "call_invite",
  "call_accept",
  "call_reject",
  "call_hangup",
  "call_signal",
]);

export type { MsgRecord, MsgStatus, MsgStatusEvent, ChatMessage, ChatKind, PresenceEvent, PaxTrajectoryData };

/** Mirrors HubStore.RobotRequest — kept local to avoid feature↔service cycles. */
export type RobotRequestPayload = {
  id: string;
  serviceType: string;
  partySize: number;
  origin: string;
  destination: string;
  note: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

export type RobotRequestEvent = {
  type: "robot_request" | "robot_request_update" | "robot_request_cleared";
  tenantId: string;
  passengerId: string;
  request: RobotRequestPayload;
  at?: number;
};

interface WsServerMsg {
  type: string;
  [key: string]: unknown;
}

function asCallEvent(m: WsServerMsg): CallEvent | null {
  if (!CALL_EVENT_TYPES.has(m.type as CallEventType)) return null;
  const callId = typeof m.callId === "string" ? m.callId : "";
  const passengerId = typeof m.passengerId === "string" ? m.passengerId : "";
  if (!callId || !passengerId) return null;
  return m as unknown as CallEvent;
}

function safeParse(s: string): WsServerMsg | null {
  try {
    const v: unknown = JSON.parse(s);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const obj = v as Record<string, unknown>;
    return typeof obj["type"] === "string" ? (obj as WsServerMsg) : null;
  } catch {
    return null;
  }
}

const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 20_000;

/**
 * Shared reconnect scheduling for both realtime clients below.
 *
 * Fixes two issues with the previous fixed-delay retry:
 *  - Calling `close()` cleared any *already-scheduled* reconnect timer, but
 *    `ws.close()` itself fires `onclose` asynchronously, which unconditionally
 *    scheduled a *new* one — so a component that closed its connection on
 *    unmount would see it reconnect ~1.2s later anyway. `markClosed()` flips
 *    a flag `onclose` must check before scheduling.
 *  - A fixed 1.2s retry with no backoff hammers the server during an outage
 *    and can synchronize many clients' reconnect attempts together.
 */
function createReconnectController(connect: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  return {
    isClosed: () => closed,
    /** Call from `onopen` once a connection succeeds. */
    reset: () => { attempt = 0; },
    /** Call from `onclose`. No-ops if `markClosed()` already ran. */
    scheduleReconnect: () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      const backoff = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** attempt);
      const jitter = backoff * (0.5 + Math.random() * 0.5); // 50%-100% of the backoff
      attempt += 1;
      timer = setTimeout(connect, jitter);
    },
    /** Call from `close()`: cancels any pending retry and stops future ones. */
    markClosed: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type AdminRealtime = {
  isConnected(): boolean;
  send(passengerId: string, body: string, title?: string, messageId?: string): string;
  chatSend(passengerId: string, body: string, kind?: ChatKind, gateRef?: string): void;
  sendCall(passengerId: string, event: Omit<CallEvent, "passengerId">): void;
  requestLocation(passengerId: string): void;
  fetchHistory(passengerId: string): void;
  close(): void;
};

export function connectAdminRealtime(opts: {
  tenantId: string;
  onPresence?(e: PresenceEvent): void;
  onMsg?(r: MsgRecord): void;
  onStatus?(e: MsgStatusEvent): void;
  onChatMsg?(m: ChatMessage): void;
  onChatHistory?(passengerId: string, messages: ChatMessage[]): void;
  onChatRead?(passengerId: string, messageId: string, at: number): void;
  onPaxTrajectory?(passengerId: string, data: PaxTrajectoryData): void;
  onPaxTrajectoryClear?(passengerId: string): void;
  onRobotRequest?(ev: RobotRequestEvent): void;
  onCall?(e: CallEvent): void;
  onConnectionChange?(up: boolean): void;
}): AdminRealtime {
  const { tenantId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  const reconnect = createReconnectController(() => connect());

  const connect = () => {
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      connected = true;
      reconnect.reset();
      opts.onConnectionChange?.(true);
      ws?.send(JSON.stringify({ type: "hello", role: "admin", tenantId }));
    };
    ws.onclose = () => {
      connected = false;
      opts.onConnectionChange?.(false);
      reconnect.scheduleReconnect();
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      const m = safeParse(String(ev.data));
      if (!m) return;
      if (m.type === "presence") opts.onPresence?.(m as unknown as PresenceEvent);
      if (m.type === "msg") opts.onMsg?.(m.record as MsgRecord);
      if (m.type === "msg_status") opts.onStatus?.(m as unknown as MsgStatusEvent);
      if (m.type === "chat_msg") opts.onChatMsg?.(m.message as ChatMessage);
      if (m.type === "chat_history") {
        opts.onChatHistory?.(m.passengerId as string, m.messages as ChatMessage[]);
      }
      if (m.type === "chat_read") {
        opts.onChatRead?.(m.passengerId as string, m.messageId as string, m.at as number);
      }
      if (m.type === "pax_trajectory" && m.passengerId && m.position) {
        const pos = m.position as Record<string, unknown>;
        const lat = Number(pos.lat);
        const lng = Number(pos.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const pathRaw = Array.isArray(m.path) ? m.path : [];
        const path = pathRaw.length
          ? pathRaw
              .map((pt: unknown) => {
                const p = pt as Record<string, unknown>;
                return { lat: Number(p.lat), lng: Number(p.lng) };
              })
              .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
          : [];
        opts.onPaxTrajectory?.(m.passengerId as string, {
          path: path.length ? path : [{ lat, lng }],
          position: { lat, lng },
        });
      }
      if (m.type === "pax_trajectory_clear" && m.passengerId) {
        opts.onPaxTrajectoryClear?.(m.passengerId as string);
      }
      if (
        (m.type === "robot_request" || m.type === "robot_request_update" || m.type === "robot_request_cleared") &&
        m.passengerId &&
        m.request
      ) {
        opts.onRobotRequest?.(m as unknown as RobotRequestEvent);
      }
      const call = asCallEvent(m);
      if (call) opts.onCall?.(call);
    };
  };

  connect();

  return {
    isConnected: () => connected,
    send: (passengerId, body, title, messageId) => {
      const id = messageId || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "send", tenantId, passengerId, title, body, messageId: id }));
      }
      return id;
    },
    chatSend: (passengerId, body, kind = "text", gateRef) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_send", tenantId, passengerId, body, kind, gateRef }));
      }
    },
    sendCall: (passengerId, event) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...event, tenantId, passengerId }));
      }
    },
    requestLocation: (passengerId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "loc_request", tenantId, passengerId }));
      }
    },
    fetchHistory: (passengerId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_fetch", tenantId, passengerId }));
      }
    },
    close: () => {
      reconnect.markClosed();
      try { ws?.close(); } catch { /* ignore */ }
      ws = null;
    },
  };
}

export type PaxRealtime = {
  isConnected(): boolean;
  ack(messageId: string): void;
  chatSend(body: string, kind?: ChatKind, gateRef?: string): void;
  sendCall(event: Omit<CallEvent, "passengerId">): void;
  sendTrajectory(path: { lat: number; lng: number }[], position: { lat: number; lng: number }): void;
  markRead(messageId: string): void;
  close(): void;
};

export function connectPaxRealtime(opts: {
  tenantId: string;
  passengerId: string;
  sessionToken?: string;
  displayName?: string;
  plan?: string;
  flightId?: string;
  gateId?: string;
  onMessage?(r: MsgRecord): void;
  onAckOk?(messageId: string): void;
  onChatMsg?(m: ChatMessage): void;
  onChatHistory?(messages: ChatMessage[]): void;
  onMarkRead?(): void;
  onLocRequest?(): void;
  onRobotRequest?(ev: RobotRequestEvent): void;
  onCall?(e: CallEvent): void;
  onConnectionChange?(up: boolean): void;
}): PaxRealtime {
  const { tenantId, passengerId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  const reconnect = createReconnectController(() => connect());

  const connect = () => {
    const url = wsUrl();
    // #region agent log
    const dbgWs = (message: string, data: Record<string, unknown>) => {
      void fetch("/api/debug-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          runId: "post-fix", hypothesisId: "WS",
          location: "src/services/realtime.ts", message, data, timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    dbgWs("pax ws connecting", { url, pageProtocol: location.protocol });
    // #endregion
    ws = new WebSocket(url);
    ws.onopen = () => {
      connected = true;
      reconnect.reset();
      opts.onConnectionChange?.(true);
      // #region agent log
      dbgWs("pax ws open", { url });
      // #endregion
      ws?.send(JSON.stringify({
        type: "hello",
        role: "pax",
        tenantId,
        passengerId,
        sessionToken: opts.sessionToken,
        displayName: opts.displayName,
        name: opts.displayName,
        plan: opts.plan,
        flightId: opts.flightId,
        gateId: opts.gateId,
      }));
    };
    ws.onclose = (ev) => {
      connected = false;
      opts.onConnectionChange?.(false);
      // #region agent log
      // A 1008 here means the server rejected the hello (bad/expired session
      // token); anything else points at the transport in front of it.
      dbgWs("pax ws closed", { code: ev.code, reason: String(ev.reason || "").slice(0, 120), wasClean: ev.wasClean });
      // #endregion
      reconnect.scheduleReconnect();
    };
    ws.onerror = () => {
      // #region agent log
      dbgWs("pax ws error", { url });
      // #endregion
    };
    ws.onmessage = (ev) => {
      const m = safeParse(String(ev.data));
      if (!m) return;
      if (m.type === "message") opts.onMessage?.(m.record as MsgRecord);
      if (m.type === "ack_ok") opts.onAckOk?.(m.messageId as string);
      if (m.type === "chat_msg") {
        opts.onChatMsg?.(m.message as ChatMessage);
        opts.onMarkRead?.();
      }
      if (m.type === "chat_history") opts.onChatHistory?.(m.messages as ChatMessage[]);
      if (m.type === "loc_request") opts.onLocRequest?.();
      if (
        (m.type === "robot_request" || m.type === "robot_request_update" || m.type === "robot_request_cleared") &&
        m.request
      ) {
        opts.onRobotRequest?.(m as unknown as RobotRequestEvent);
      }
      const call = asCallEvent(m);
      if (call) opts.onCall?.(call);
    };
  };

  connect();

  return {
    isConnected: () => connected,
    ack: (messageId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ack", tenantId, passengerId, messageId }));
      }
    },
    chatSend: (body, kind = "text", gateRef) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_send", tenantId, passengerId, body, kind, gateRef }));
      }
    },
    sendCall: (event) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...event, tenantId, passengerId }));
      }
    },
    sendTrajectory: (path, position) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "pax_trajectory", tenantId, passengerId, path, position }));
      }
    },
    markRead: (messageId: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_read", tenantId, passengerId, messageId, at: Date.now() }));
      }
    },
    close: () => {
      reconnect.markClosed();
      try { ws?.close(); } catch { /* ignore */ }
      ws = null;
    },
  };
}
