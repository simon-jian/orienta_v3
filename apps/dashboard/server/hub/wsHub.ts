/**
 * WebSocket hub entry point.
 *
 * Wires HubStore + presence + chat + trajectory sub-modules together.
 * Replaces the monolithic 642-line wsHub.ts.
 *
 * Key change (H6): HubStore is injected rather than using module-level singletons,
 * making the hub testable without starting a real HTTP server.
 */
import type { ViteDevServer } from "vite";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import { HubStore } from "./HubStore";
import {
  cancelPaxOffline,
  schedulePaxOffline,
  setPresence,
} from "./presence";
import { handlePaxOutboundChat } from "./chat";
import { storeAndBroadcastTrajectory } from "./trajectory";
import { airportForTenant } from "../../src/config/tenants/registry";
import { getAirportOrDefault } from "../../src/config/airports/registry";
import type { ChatKind, MsgRecord, MsgStatus } from "../../src/types/types";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";
import { resolvePaxWsHello } from "../passengers/paxWsIdentity";
import type { PaxSessionClaims } from "../passengers/paxSessionToken";
import { adminPayloadFromCookieHeader } from "../auth/adminAuth";
import { paxCanSendChat, legacyPlanForPassenger } from "../auth/paxAuthPolicy";

type Role = "admin" | "pax";

const HELLO_TIMEOUT_MS = 8000;

/** Loose shape of an incoming WS protocol message. All fields beyond `type` are unknown. */
interface WsMsg {
  type: string;
  [key: string]: unknown;
}

function safeJsonParse(s: string): WsMsg | null {
  try {
    const v: unknown = JSON.parse(s);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const obj = v as Record<string, unknown>;
    return typeof obj["type"] === "string" ? (obj as WsMsg) : null;
  } catch {
    return null;
  }
}

function wsSend(ws: WebSocket, obj: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

export { HubStore };

/**
 * Attach the WebSocket hub to an HTTP server.
 *
 * @param server   - Vite dev server or raw Node http.Server
 * @param store    - Shared HubStore instance (also used by API routes)
 * @param registry - PassengerRegistry: creates/updates passengers on pax hello
 */
export function attachWsHub(
  server: ViteDevServer | HttpServer,
  store: HubStore,
  registry?: PassengerRegistry,
): WebSocketServer | null {
  const httpServer = "httpServer" in server ? server.httpServer : server;
  if (!httpServer) return null;

  // Disable permessage-deflate: compressed frames break many tunnel clients
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/ws") return;
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch { /* ignore invalid upgrade URLs */ }
  });

  wss.on("connection", (ws, req: IncomingMessage) => {
    let role: Role | null = null;
    let tenantId: string | null = null;
    let passengerId: string | null = null;
    let paxClaims: PaxSessionClaims | null = null;

    const helloTimeout = setTimeout(() => {
      try { ws.close(1008, "missing hello"); } catch { /* ignore close errors */ }
    }, HELLO_TIMEOUT_MS);

    ws.on("message", (raw) => {
      const msg = safeJsonParse(String(raw));
      if (!msg) return;

      // ── HELLO ────────────────────────────────────────────────────────────────
      if (msg.type === "hello") {
        if (role) return;
        clearTimeout(helloTimeout);
        role = msg.role === "admin" || msg.role === "pax" ? msg.role : null;

        if (role === "admin") {
          void (async () => {
            const adminPayload = await adminPayloadFromCookieHeader(req.headers.cookie);
            if (!adminPayload) {
              ws.close(1008, "admin_not_authenticated");
              return;
            }

            tenantId = typeof msg.tenantId === "string" ? msg.tenantId : null;
            if (!tenantId) { ws.close(1008, "missing tenant"); return; }

            const set = store.adminSockets.get(tenantId) || new Set<WebSocket>();
            set.add(ws);
            store.adminSockets.set(tenantId, set);

            // Send current presence snapshot (cluster-wide when Redis is enabled)
            for (const pid of await store.listOnlineGlobal(tenantId)) {
              if (!pid) continue;
              wsSend(ws, { type: "presence", tenantId, passengerId: pid, online: true, at: Date.now() });
            }
            // Send current trajectories
            for (const [key, data] of store.paxTrajectories) {
              if (!key.startsWith(`${tenantId}::`)) continue;
              const pid = key.split("::")[1] || "";
              wsSend(ws, { type: "pax_trajectory", tenantId, passengerId: pid, path: data.path, position: data.position });
            }
            // Send recent messages
            for (const r of store.recentMessages(tenantId)) {
              wsSend(ws, { type: "msg", record: r });
            }
          })();
          return;
        }

        if (role === "pax") {
          void (async () => {
            const resolved = await resolvePaxWsHello(msg);
            if (!resolved.ok) {
              ws.close(1008, resolved.reason);
              return;
            }

            const { identity } = resolved;
            tenantId = identity.tenantId;
            passengerId = identity.passengerId;
            paxClaims = identity.claims;

            const plan = identity.claims?.plan ?? legacyPlanForPassenger(passengerId);

            const key = HubStore.key(tenantId, passengerId);
            const wasOnline = store.online.has(key);

            store.paxMeta.set(key, {
              displayName: typeof msg.displayName === "string" ? msg.displayName : undefined,
              plan,
            });

            // Register or update passenger in the registry.
            // flightId / gateId come from URL params forwarded in the hello.
            // If missing, we still create a shell record; admin can fill in later.
            if (registry) {
              const flightId = String(msg.flightId || msg.dep || msg.flight || "").trim();
              const gateId   = String(msg.gateId   || msg.gateTo || "").trim();
              if (flightId && gateId) {
                await registry.getOrCreate({
                  id: passengerId, tenantId,
                  name:            String(msg.name || msg.displayName || "").trim() || undefined,
                  locale:          String(msg.locale || "").trim() || undefined,
                  nationality:     String(msg.nat || msg.nationality || "").trim() || undefined,
                  needsWheelchair: !!msg.needsWheelchair,
                  plan:            plan === "premium" ? "premium" : "free",
                  flightId, gateId,
                  inboundFlightId: String(msg.inboundFlightId || msg.arr || "").trim() || undefined,
                  inboundFrom:     String(msg.inboundFrom     || "").trim() || undefined,
                  outboundTo:      String(msg.outboundTo      || "").trim() || undefined,
                  source: "qr_scan",
                });
              }
              await registry.markOnline(tenantId, passengerId);
            }

            const set = store.paxSockets.get(key) || new Set<WebSocket>();
            set.add(ws);
            store.paxSockets.set(key, set);
            cancelPaxOffline(store, tenantId, passengerId);
            setPresence(store, tenantId, passengerId, true);

            // WS flap: re-broadcast presence so admin doesn't miss it
            if (wasOnline) {
              store.broadcastAdmins(tenantId, { type: "presence", tenantId, passengerId, online: true, at: Date.now() });
            }

            // System message on first login
            if (!wasOnline) {
              const display = store.paxMeta.get(key)?.displayName || passengerId;
              const sysMsg = {
                id: crypto.randomUUID(), passengerId, tenantId,
                from: "system" as const, kind: "system" as ChatKind,
                body: `✅ Passenger online: ${display} (${passengerId})`,
                createdAt: Date.now(),
              };
              store.appendChat(tenantId, passengerId, sysMsg);
              store.broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
              store.broadcastPax(tenantId, passengerId, { type: "chat_msg", message: sysMsg });
            }

            // Deliver pending messages
            const pending = Array.from(store.messages.values())
              .filter((r) => r.tenantId === tenantId && r.passengerId === passengerId && r.status !== "ack")
              .sort((a, b) => a.createdAt - b.createdAt)
              .slice(-10);
            for (const rec of pending) {
              wsSend(ws, { type: "message", record: rec, requireAck: true });
              if (rec.status === "sent") {
                const updated = store.updateMessageStatus(rec.messageId, { status: "delivered", deliveredAt: Date.now() });
                if (updated) {
                  store.broadcastAdmins(tenantId, {
                    type: "msg_status", tenantId, passengerId: rec.passengerId,
                    messageId: rec.messageId, status: "delivered",
                    createdAt: updated.createdAt, deliveredAt: updated.deliveredAt,
                  });
                }
              }
            }

            // Send chat history (last 20)
            const hist = (await store.ensureChatHistory(tenantId, passengerId)).slice(-20);
            wsSend(ws, { type: "chat_history", passengerId, messages: hist });
          })();
          return;
        }

        ws.close(1008, "invalid role");
        return;
      }

      if (!role || !tenantId) return;

      // ── ADMIN: one-way push message ───────────────────────────────────────────
      if (role === "admin" && msg.type === "send") {
        const targetPid = String(msg.passengerId ?? "").trim();
        const body = typeof msg.body === "string" ? msg.body : "";
        if (!targetPid || !body) return;
        const id = typeof msg.messageId === "string" ? msg.messageId : crypto.randomUUID();
        const title = typeof msg.title === "string" ? msg.title : "Orienta 通知";
        const rec: MsgRecord = {
          messageId: id, tenantId, passengerId: targetPid,
          title, body,
          createdAt: Date.now(), status: "sent",
        };
        store.messages.set(rec.messageId, rec);
        store.broadcastAdmins(tenantId, { type: "msg", record: rec });

        // Deliver immediately if pax is connected
        const paxKey = HubStore.key(tenantId, targetPid);
        const paxSet = store.paxSockets.get(paxKey);
        if (paxSet && paxSet.size > 0) {
          for (const pws of paxSet) wsSend(pws, { type: "message", record: rec, requireAck: true });
          const updated = store.updateMessageStatus(rec.messageId, { status: "delivered", deliveredAt: Date.now() });
          if (updated) {
            store.broadcastAdmins(tenantId, {
              type: "msg_status", tenantId, passengerId: rec.passengerId,
              messageId: rec.messageId, status: "delivered",
              createdAt: updated.createdAt, deliveredAt: updated.deliveredAt,
            });
          }
        }
        return;
      }

      // ── PAX: ack one-way message ───────────────────────────────────────────────
      if (role === "pax" && msg.type === "ack") {
        const ackId = typeof msg.messageId === "string" ? msg.messageId : "";
        const rec = ackId ? store.messages.get(ackId) : undefined;
        if (!rec || rec.tenantId !== tenantId) return;
        if (passengerId && rec.passengerId !== passengerId) return;
        const updated = store.updateMessageStatus(ackId, { status: "ack", ackAt: Date.now(), deliveredAt: rec.deliveredAt ?? Date.now() });
        if (updated) {
          store.broadcastAdmins(tenantId, {
            type: "msg_status", tenantId, passengerId: updated.passengerId,
            messageId: updated.messageId, status: "ack" as MsgStatus,
            createdAt: updated.createdAt, deliveredAt: updated.deliveredAt, ackAt: updated.ackAt,
          });
          wsSend(ws, { type: "ack_ok", messageId: ackId });
        }
        return;
      }

      // ── ADMIN: send chat message ───────────────────────────────────────────────
      if (role === "admin" && msg.type === "chat_send") {
        const pid = String(msg.passengerId ?? "").trim();
        const body = typeof msg.body === "string" ? msg.body : "";
        const kind = typeof msg.kind === "string" ? msg.kind : "text";
        const gateRef = typeof msg.gateRef === "string" ? msg.gateRef : undefined;
        if (!pid || !body) return;
        const chatMsg = {
          id: crypto.randomUUID(), passengerId: pid, tenantId,
          from: "admin" as const, kind: kind as ChatKind, body, gateRef,
          createdAt: Date.now(),
        };
        store.appendChat(tenantId, pid, chatMsg);
        store.broadcastAdmins(tenantId, { type: "chat_msg", message: chatMsg }, ws);
        store.broadcastPax(tenantId, pid, { type: "chat_msg", message: chatMsg });
        return;
      }

      // ── PAX: send chat message ─────────────────────────────────────────────────
      if (role === "pax" && msg.type === "chat_send") {
        if (!passengerId) return;
        const body = typeof msg.body === "string" ? msg.body : "";
        const kind = typeof msg.kind === "string" ? msg.kind : "text";
        const gateRef = typeof msg.gateRef === "string" ? msg.gateRef : undefined;
        if (!body) return;
        if (!paxCanSendChat(paxClaims, store, tenantId, passengerId, kind)) {
          wsSend(ws, { type: "error", code: "chat_not_allowed_for_plan" });
          return;
        }
        handlePaxOutboundChat(store, tenantId, passengerId, body, kind as ChatKind, gateRef);
        return;
      }

      // ── PAX: navigation request ────────────────────────────────────────────────
      if (role === "pax" && msg.type === "nav_request") {
        if (!passengerId) return;
        const kind = msg.kind || "transfer";
        let fromGate = "—";
        let toGate = "—";
        if (kind === "transfer") {
          const gateMap = getAirportOrDefault(airportForTenant(tenantId)).demo?.flightGateMap ?? {};
          const a = String(msg.arrivalFlight || "").toUpperCase().trim();
          const d = String(msg.departureFlight || "").toUpperCase().trim();
          fromGate = gateMap[a] || gateMap[a.replace(/\s+/g, "")] || "—";
          toGate   = gateMap[d] || gateMap[d.replace(/\s+/g, "")] || "—";
        } else {
          const q = String(msg.query || "");
          const m = q.toUpperCase().match(/\b([A-Z]\d{1,2})\b/g) || [];
          if (m.length >= 2) { fromGate = m[0]!; toGate = m[1]!; }
        }
        const sysMsg = {
          id: crypto.randomUUID(), passengerId, tenantId,
          from: "system" as const, kind: "system" as ChatKind,
          body: `🗺️ Navigation plan: ${fromGate} → ${toGate}`,
          createdAt: Date.now(),
        };
        store.appendChat(tenantId, passengerId, sysMsg);
        store.broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
        store.broadcastPax(tenantId, passengerId, { type: "chat_msg", message: sysMsg });
        return;
      }

      // ── PAX: mark messages as read ─────────────────────────────────────────────
      if (role === "pax" && msg.type === "chat_read") {
        const messageId = typeof msg.messageId === "string" ? msg.messageId : "";
        const at = typeof msg.at === "number" ? msg.at : Date.now();
        if (!messageId || !passengerId) return;
        store.broadcastAdmins(tenantId, { type: "chat_read", passengerId, messageId, at });
        return;
      }

      // ── ADMIN: request passenger location ─────────────────────────────────────
      if (role === "admin" && msg.type === "loc_request") {
        const pid = String(msg.passengerId ?? "").trim();
        if (!pid) return;
        const sysMsg = {
          id: crypto.randomUUID(), passengerId: pid, tenantId,
          from: "system" as const, kind: "system" as ChatKind,
          body: "📍 Location request: Please tell us where you are right now so we can update your navigation.",
          createdAt: Date.now(),
        };
        store.appendChat(tenantId, pid, sysMsg);
        store.broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
        store.broadcastPax(tenantId, pid, { type: "chat_msg", message: sysMsg });
        store.broadcastPax(tenantId, pid, { type: "loc_request", passengerId: pid, at: Date.now() });
        return;
      }

      // ── PAX: live trajectory ───────────────────────────────────────────────────
      if (role === "pax" && msg.type === "pax_trajectory") {
        if (!passengerId || !tenantId) return;
        const path = Array.isArray(msg.path) ? msg.path : [];
        const posRaw = msg.position as Record<string, unknown> | null | undefined;
        const pos =
          posRaw && typeof posRaw.lat === "number" && typeof posRaw.lng === "number"
            ? { lat: posRaw.lat, lng: posRaw.lng }
            : null;
        storeAndBroadcastTrajectory(store, tenantId, passengerId, path, pos);
        return;
      }

      // ── ADMIN or PAX: fetch chat history ──────────────────────────────────────
      if (msg.type === "chat_fetch") {
        const pid =
          role === "pax"
            ? passengerId
            : String(msg.passengerId ?? "").trim();
        if (!pid) return;
        const tid = tenantId;
        void (async () => {
          const hist = (await store.ensureChatHistory(tid, pid)).slice(-20);
          wsSend(ws, { type: "chat_history", passengerId: pid, messages: hist });
        })();
        return;
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimeout);
      if (role === "admin" && tenantId) {
        const set = store.adminSockets.get(tenantId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) store.adminSockets.delete(tenantId);
        }
      }
      if (role === "pax" && tenantId && passengerId) {
        const key = HubStore.key(tenantId, passengerId);
        const set = store.paxSockets.get(key);
        if (set) {
          set.delete(ws);
          if (set.size === 0) store.paxSockets.delete(key);
        }
        const still = store.paxSockets.get(key);
        if (!still || still.size === 0) {
          schedulePaxOffline(store, tenantId, passengerId);
          void registry?.markOffline(tenantId, passengerId);
        }
      }
    });
  });

  httpServer.once("close", () => {
    try { wss.close(); } catch { /* ignore close errors */ }
  });

  return wss;
}
