import { useCallback, useEffect, useRef, useState } from "react";
import type { CallEvent, ChatKind, ChatMessage, MsgRecord } from "../../../types/types";
import { connectPaxRealtime, type PaxRealtime, type RobotRequestEvent } from "../../../services/realtime";
import type { PaxSession } from "../session";
import { postPaxApi, postPaxFallback } from "../assist/postPaxApi";
import { mergeChatHistory, upsertChatMessage } from "../assist/chatMerge";
import type { RobotRequest } from "../assist/assistTypes";
import { apiUrl } from "../../../config/api";
import { usePaxT } from "../i18n";

const PRESENCE_OK_TTL_MS = 20_000;
const CHAT_POLL_MS = 4_000;

export function usePaxRealtimeSession(
  session: PaxSession | null,
  opts?: { onRobotRequest?: (ev: RobotRequestEvent) => void },
) {
  const t = usePaxT();
  const [rtUp, setRtUp] = useState(false);
  const [presenceOk, setPresenceOk] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<MsgRecord[]>([]);
  const [unreadChat, setUnreadChat] = useState(false);
  const [locationStatus, setLocationStatus] = useState(() => t("chat.locationIdle"));
  /** undefined = no WS event yet; null = cleared; object = live status */
  const [liveRobotRequest, setLiveRobotRequest] = useState<RobotRequest | null | undefined>(undefined);
  const realtimeRef = useRef<PaxRealtime | null>(null);
  const onCallRef = useRef<((ev: CallEvent) => void) | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onRobotRequestRef = useRef(opts?.onRobotRequest);
  onRobotRequestRef.current = opts?.onRobotRequest;
  const presenceOkTimerRef = useRef<number | null>(null);

  const sessionToken = session?.token ?? "";
  const passengerId = session?.passenger.id ?? "";
  const tenantId = session?.passenger.tenantId ?? "";
  const displayName = session?.passenger.name ?? "";
  const plan = session?.plan ?? "free";
  const flightId = session?.passenger.flightId ?? "";
  const gateId = session?.passenger.gateId ?? "";

  function markPresenceOk() {
    setPresenceOk(true);
    if (presenceOkTimerRef.current) window.clearTimeout(presenceOkTimerRef.current);
    presenceOkTimerRef.current = window.setTimeout(() => setPresenceOk(false), PRESENCE_OK_TTL_MS);
  }

  useEffect(() => {
    if (!sessionToken || !passengerId || !tenantId) return;
    const rt = connectPaxRealtime({
      tenantId,
      passengerId,
      displayName,
      plan,
      flightId,
      gateId,
      sessionToken,
      onConnectionChange: setRtUp,
      onMessage: (msg) => {
        setNotifications((prev) => [msg, ...prev].slice(0, 20));
        rt.ack(msg.messageId);
      },
      onChatMsg: (msg) => {
        setChat((prev) => upsertChatMessage(prev, msg));
        if (msg.from !== "pax") setUnreadChat(true);
      },
      onChatHistory: (messages) => setChat((prev) => mergeChatHistory(prev, messages)),
      onCall: (ev) => onCallRef.current?.(ev),
      onLocRequest: () => setLocationStatus(t("chat.locRequest")),
      onRobotRequest: (ev) => {
        const req = ev.request as RobotRequest;
        if (ev.type === "robot_request_cleared" || req.status === "cancelled") {
          setLiveRobotRequest(null);
        } else {
          setLiveRobotRequest(req);
        }
        onRobotRequestRef.current?.(ev);
      },
    });
    realtimeRef.current = rt;
    return () => {
      rt.close();
      realtimeRef.current = null;
      setRtUp(false);
    };
  }, [sessionToken, passengerId, tenantId, displayName, plan, flightId, gateId, t]);

  useEffect(() => {
    if (!sessionToken) return;

    let cancelled = false;
    const beat = async () => {
      const s = sessionRef.current;
      if (!s) return;
      try {
        const res = await postPaxApi(s, "/api/pax/presence", { online: true });
        if (!cancelled && res.ok) markPresenceOk();
      } catch {
        /* ignore */
      }
    };

    void beat();
    const timer = window.setInterval(() => void beat(), 12_000);
    const markOffline = () => {
      const s = sessionRef.current;
      if (s) postPaxFallback(s, "/api/pax/presence", { online: false });
    };
    window.addEventListener("pagehide", markOffline);
    window.addEventListener("beforeunload", markOffline);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", markOffline);
      window.removeEventListener("beforeunload", markOffline);
      if (presenceOkTimerRef.current) window.clearTimeout(presenceOkTimerRef.current);
    };
  }, [sessionToken]);

  // HTTP chat history poll — keeps admin↔pax in sync when WS is flaky (tunnel).
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;

    const pull = async () => {
      const s = sessionRef.current;
      if (!s) return;
      try {
        const res = await fetch(apiUrl("/api/pax/chat-history"), {
          headers: { Authorization: `Bearer ${s.token}` },
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          messages?: ChatMessage[];
        };
        if (cancelled || !res.ok || !data.ok || !Array.isArray(data.messages)) return;
        setChat((prev) => mergeChatHistory(prev, data.messages!));
      } catch {
        /* ignore */
      }
    };

    void pull();
    const timer = window.setInterval(() => void pull(), CHAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionToken]);

  async function sendChatHttp(body: string, kind: ChatKind = "text", gateRef?: string) {
    const s = sessionRef.current;
    if (!s) return null;
    const res = await postPaxApi(s, "/api/pax/chat-send", { body, kind, gateRef });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: ChatMessage; error?: string };
    if (!res.ok || !data.ok || !data.message) {
      throw new Error(data.error || `chat_send_failed_${res.status}`);
    }
    return data.message;
  }

  function sendChat(body: string) {
    const s = sessionRef.current;
    if (!s || !body.trim()) return;
    const localId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const localMsg: ChatMessage = {
      id: localId,
      passengerId: s.passenger.id,
      tenantId: s.passenger.tenantId,
      from: "pax",
      kind: "text",
      body: body.trim(),
      createdAt: Date.now(),
    };
    setChat((prev) => [...prev, localMsg].slice(-50));

    const rt = realtimeRef.current;
    if (rt?.isConnected()) {
      rt.chatSend(body.trim());
      return;
    }

    void sendChatHttp(body.trim())
      .then((msg) => {
        if (msg) setChat((prev) => upsertChatMessage(prev, msg));
      })
      .catch(() => {
        setChat((prev) => prev.filter((m) => m.id !== localId));
        setLocationStatus(t("chat.sendFailed"));
      });
  }

  const sendCall = useCallback((event: Omit<CallEvent, "passengerId">) => {
    realtimeRef.current?.sendCall(event);
  }, []);

  const registerCallHandler = useCallback((fn: ((ev: CallEvent) => void) | null) => {
    onCallRef.current = fn;
  }, []);

  async function sendVoiceNote(blob: Blob, durationMs: number) {
    const s = sessionRef.current;
    if (!s) throw new Error("missing_session");
    const res = await fetch(apiUrl("/api/pax/voice-note"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": blob.type || "audio/webm",
        "X-Voice-Duration-Ms": String(Math.round(durationMs)),
      },
      body: blob,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: ChatMessage;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.message) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setChat((prev) => upsertChatMessage(prev, data.message!));
  }

  function shareLocation(targetGateId: string) {
    const text = `Passenger reports current target gate: ${targetGateId}`;
    const rt = realtimeRef.current;
    if (rt?.isConnected()) {
      rt.chatSend(text, "location", targetGateId);
    } else {
      void sendChatHttp(text, "location", targetGateId).catch(() => {});
    }
    setLocationStatus(t("chat.shareRequested", { gate: targetGateId }));
  }

  return {
    rtUp,
    presenceOk,
    chat,
    setChat,
    notifications,
    unreadChat,
    setUnreadChat,
    locationStatus,
    setLocationStatus,
    liveRobotRequest,
    realtimeRef,
    sendChat,
    sendCall,
    registerCallHandler,
    sendVoiceNote,
    shareLocation,
  };
}
