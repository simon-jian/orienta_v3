/**
 * WebSocket realtime service — types now come from the canonical types/index.
 *
 * Updated imports: all shared types imported from ../types/index.
 */
import type {
  MsgRecord, MsgStatus, MsgStatusEvent, ChatMessage, ChatKind,
  PresenceEvent, PaxTrajectoryData,
} from "../types/types";
import { wsUrl } from "../config/api";

export type { MsgRecord, MsgStatus, MsgStatusEvent, ChatMessage, ChatKind, PresenceEvent, PaxTrajectoryData };

interface WsServerMsg {
  type: string;
  [key: string]: unknown;
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

const WS_RECONNECT_DELAY_MS = 1200;

export type AdminRealtime = {
  isConnected(): boolean;
  send(passengerId: string, body: string, title?: string, messageId?: string): string;
  chatSend(passengerId: string, body: string, kind?: ChatKind, gateRef?: string): void;
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
  onConnectionChange?(up: boolean): void;
}): AdminRealtime {
  const { tenantId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      connected = true;
      opts.onConnectionChange?.(true);
      ws?.send(JSON.stringify({ type: "hello", role: "admin", tenantId }));
    };
    ws.onclose = () => {
      connected = false;
      opts.onConnectionChange?.(false);
      reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close(); } catch { /* ignore */ }
      ws = null;
    },
  };
}

export type PaxRealtime = {
  isConnected(): boolean;
  ack(messageId: string): void;
  chatSend(body: string, kind?: ChatKind, gateRef?: string): void;
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
  onConnectionChange?(up: boolean): void;
}): PaxRealtime {
  const { tenantId, passengerId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      connected = true;
      opts.onConnectionChange?.(true);
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
    ws.onclose = () => {
      connected = false;
      opts.onConnectionChange?.(false);
      reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
    };
    ws.onerror = () => {};
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close(); } catch { /* ignore */ }
      ws = null;
    },
  };
}
