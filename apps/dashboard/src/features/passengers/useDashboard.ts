/**
 * useDashboard — all dashboard state and passenger computation.
 *
 * Extracted from the 974-line App.tsx. This hook owns:
 *   - Sim world state + tick loop
 *   - Realtime WebSocket connection
 *   - Presence + trajectory state
 *   - Chat history
 *   - Passenger list computation (computePassenger + presence overlay)
 *   - Priority list + risk counts
 *
 * M2: hardcoded passenger IDs replaced by
 * the `presenceBehavior` and `sortPriority` fields on each scenario.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PassengerComputed, PaxExtStatus, LatLng, Gate, Flight, ChatMessage,
  MsgRecord, MsgStatusEvent, PresenceEvent, PaxTrajectoryData, AdminSession,
  Passenger,
} from "../../types/types";
import { computePassenger } from "../../utils/passenger-compute";
import { connectAdminRealtime, type AdminRealtime } from "../../services/realtime";
import { apiUrl } from "../../config/api";
import { fetchPassengers } from "../../services/passengers/passengerSource";
import type { AdminRobotRequest } from "./RobotRequestQueue";
import type { RobotRequest } from "../pax/assist/assistTypes";
import { mergeChatHistory, upsertChatMessage } from "../pax/assist/chatMerge";

export type ToastItem = { id: string; title: string; body: string };

/** Fixed set of keys — matches the literal object riskCounts is always initialized with below. */
export type RiskCounts = { green: number; yellow: number; red: number; missed: number; offline: number; lost: number };

export type DashboardState = {
  // Passengers
  passengers: PassengerComputed[];
  priorityList: PassengerComputed[];
  riskCounts: RiskCounts;
  /** True when the most recent passenger-list poll failed; the list shown may be stale. */
  passengersLoadError: boolean;
  /** Epoch ms of the last successful passenger-list sync, or null before the first one. */
  passengersLastSyncAt: number | null;

  // Selection / search
  selectedPaxId: string | null;
  setSelectedPaxId: (id: string | null) => void;
  hoverPaxId: string | null;
  setHoverPaxId: (id: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  passengersFilteredByGate: PassengerComputed[];

  // Map
  mapPassengers: PassengerComputed[];
  mapViewMode: "all" | "single" | "urgent";
  setMapViewMode: (m: "all" | "single" | "urgent") => void;
  paxTrajectories: Record<string, PaxTrajectoryData>;

  // Realtime
  rtUp: boolean;
  presence: Record<string, boolean>;

  // Chat
  openConvPaxId: string | null;
  setOpenConvPaxId: (id: string | null) => void;
  chatHistory: Record<string, ChatMessage[]>;
  msgById: Record<string, MsgRecord>;
  sendSms: (pid: string, msg: string) => void;
  sendChat: (pid: string, body: string) => void;
  requestLocation: (pid: string) => void;
  openConversation: (pid: string) => void;

  // Toasts
  toasts: ToastItem[];
  dismissToast: (id: string) => void;

  // Robot bookings
  robotRequests: AdminRobotRequest[];
  advanceRobotRequest: (passengerId: string) => void;
  cancelRobotRequest: (passengerId: string) => void;
};

export function useDashboard(opts: {
  tenantId: string;
  gates: Gate[];
  flights: Flight[];
  gatesById: Map<string, Gate>;
  flightsById: Map<string, Flight>;
  pekPoiReady: boolean;
  session: AdminSession;
}): DashboardState {
  const {
    tenantId, gatesById, flightsById,
    pekPoiReady,
  } = opts;

  // ── Passengers ─────────────────────────────────────────────────────────────
  const [passengersRaw, setPassengersRaw] = useState<{ passengers: Passenger[] } | null>(null);
  // Surfaced as a small "data may be stale" indicator rather than clearing the
  // list — a transient poll failure shouldn't look identical to "zero
  // passengers", nor should it blank out data that's still the best we have.
  const [passengersLoadError, setPassengersLoadError] = useState(false);
  const [passengersLastSyncAt, setPassengersLastSyncAt] = useState<number | null>(null);

  const loadPassengers = useCallback(async () => {
    const incoming = await fetchPassengers(tenantId);
    if (incoming === null) {
      setPassengersLoadError(true);
      setPassengersRaw((w) => w ?? { passengers: [] });
      return;
    }
    setPassengersLoadError(false);
    setPassengersLastSyncAt(Date.now());
    // The server response is authoritative — no local-only fields get mixed
    // into a Passenger record anywhere in this codebase (WS-driven overlays
    // like presence/chat/trajectories live in their own separate state below),
    // so there's nothing to preserve from the previous poll. A previous
    // version of this merge preferred the *old* cached record whenever the id
    // already existed, which meant a passenger's gate/status/plan changes on
    // the server were silently discarded forever after the first successful
    // load, not just delayed until the next poll.
    setPassengersRaw({ passengers: incoming });
  }, [tenantId]);

  // Reset when gate data changes, then load
  useEffect(() => {
    if (!pekPoiReady) return;
    setPassengersRaw(null);
    setSelectedPaxId(null);
    setMapViewMode("all");
    setChatHistory({});
    setPresence({});
    setPaxTrajectories({});
    void loadPassengers();
  }, [pekPoiReady, loadPassengers]);

  // Poll for newly connected passengers every 10 s
  useEffect(() => {
    const t = setInterval(() => void loadPassengers(), 10_000);
    return () => clearInterval(t);
  }, [loadPassengers]);

  // ── Realtime ───────────────────────────────────────────────────────────────
  const [rtUp, setRtUp] = useState(false);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [paxTrajectories, setPaxTrajectories] = useState<Record<string, PaxTrajectoryData>>({});
  const [msgById, setMsgById] = useState<Record<string, MsgRecord>>({});
  const [chatHistory, setChatHistory] = useState<Record<string, ChatMessage[]>>({});
  const rtRef = useRef<AdminRealtime | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [robotRequests, setRobotRequests] = useState<AdminRobotRequest[]>([]);

  const pushToast = (title: string, body: string) => {
    const id = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t.slice(-4), { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };

  const upsertRobotRequest = useCallback((passengerId: string, request: RobotRequest) => {
    setRobotRequests((prev) => {
      const next = prev.filter((r) => r.passengerId !== passengerId && r.id !== request.id);
      if (request.status === "cancelled") return next;
      return [{ ...request, passengerId }, ...next].sort((a, b) => b.createdAt - a.createdAt);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/orienta/admin-robot-requests?tenant=${encodeURIComponent(tenantId)}`),
          { credentials: "same-origin" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; requests?: AdminRobotRequest[] };
        if (!cancelled && data.ok && Array.isArray(data.requests)) {
          setRobotRequests(data.requests);
        }
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [tenantId]);

  useEffect(() => {
    const rt = connectAdminRealtime({
      tenantId,
      onConnectionChange: setRtUp,
      onPresence: (e: PresenceEvent) => {
        setPresence((m) => {
          const was = !!m[e.passengerId];
          const next = { ...m, [e.passengerId]: e.online };
          if (e.online && !was) {
            const display =
              (passengersRaw?.passengers || []).find((p) => p.id === e.passengerId)?.name ||
              e.passengerId;
            pushToast("Passenger online", `${display} (${e.passengerId})`);
          }
          return next;
        });
      },
      onMsg: (r: MsgRecord) => setMsgById((m) => ({ ...m, [r.messageId]: r })),
      onStatus: (e: MsgStatusEvent) => {
        setMsgById((m) => {
          const cur = m[e.messageId];
          if (!cur) return m;
          return { ...m, [e.messageId]: { ...cur, status: e.status, deliveredAt: e.deliveredAt ?? cur.deliveredAt, ackAt: e.ackAt ?? cur.ackAt } };
        });
      },
      onChatMsg: (msg: ChatMessage) => {
        setChatHistory((h) => ({
          ...h,
          [msg.passengerId]: upsertChatMessage(h[msg.passengerId] || [], msg),
        }));
      },
      onChatHistory: (pid: string, msgs: ChatMessage[]) => {
        setChatHistory((h) => ({ ...h, [pid]: mergeChatHistory(h[pid] || [], msgs) }));
      },
      onChatRead: (pid: string, messageId: string, at: number) => {
        setChatHistory((h) => ({
          ...h,
          [pid]: (h[pid] || []).map((m) =>
            m.id === messageId ? { ...m, status: "read" as const, readAt: at } : m
          ),
        }));
      },
      onPaxTrajectory: (pid: string, data: PaxTrajectoryData) => {
        setPaxTrajectories((t) => ({ ...t, [pid]: data }));
      },
      onPaxTrajectoryClear: (pid: string) => {
        setPaxTrajectories((t) => {
          if (!(pid in t)) return t;
          const next = { ...t };
          delete next[pid];
          return next;
        });
      },
      onRobotRequest: (ev) => {
        const req = ev.request as RobotRequest;
        if (ev.type === "robot_request_cleared" || req.status === "cancelled") {
          setRobotRequests((prev) => prev.filter((r) => r.passengerId !== ev.passengerId));
          pushToast("Robot booking cleared", ev.passengerId);
          return;
        }
        upsertRobotRequest(ev.passengerId, req);
        if (ev.type === "robot_request") {
          pushToast("Robot booking", `${ev.passengerId} · ${req.serviceType}`);
          setOpenConvPaxId(ev.passengerId);
          rtRef.current?.fetchHistory(ev.passengerId);
        }
      },
    });
    rtRef.current = rt;
    return () => { rtRef.current = null; rt.close(); };
  }, [tenantId, upsertRobotRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // HTTP presence poll (backup for flaky WS tunnels)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(apiUrl(`/api/orienta/admin-presence?tenant=${encodeURIComponent(tenantId)}`), {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j?.ok || !Array.isArray(j.online)) return;
        // Full reconciliation against the server's authoritative online list —
        // every consumer reads this with `!!presence[id]`, so an id simply
        // absent from the new map is correctly treated as offline. The
        // previous version only ever added ids, so a passenger who
        // disconnected without a clean WS close (missed the realtime
        // `presence` event too) stayed "online" here forever.
        const next: Record<string, boolean> = {};
        for (const id of j.online as string[]) next[id] = true;
        setPresence(next);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tenantId]);

  // ── Passenger computation ──────────────────────────────────────────────────

  /** Applies presenceBehavior overlays and computePassenger to produce the display list. */
  const passengers: PassengerComputed[] = useMemo(() => {
    if (!passengersRaw?.passengers) return [];

    return passengersRaw.passengers.map((p) => {
      const isOnline     = !!presence[p.id];
      const trajectory   = paxTrajectories[p.id];
      const liveTrajectory =
        trajectory?.position &&
        Number.isFinite(trajectory.position.lat) &&
        Number.isFinite(trajectory.position.lng);

      const gate   = gatesById.get(p.gateId) || null;
      const flight = flightsById.get(p.flightId) || null;

      // ── presenceBehavior: lost_when_offline ─────────────────────────────────
      // Passenger shows as "lost" when disconnected (e.g. P8-style demo).
      if (p.presenceBehavior === "lost_when_offline" && !isOnline && !liveTrajectory) {
        const lostP = { ...p, extStatus: "lost" as PaxExtStatus, activity: "idle" as const };
        return {
          ...computePassenger(lostP, flight, gate),
          extStatus: "lost" as PaxExtStatus,
          activity: "idle" as const,
          location: p.location as LatLng,
          liveVideoGateHint: undefined,
          rtOnline: false,
        } as PassengerComputed;
      }

      // ── Default: re-derive status if passenger just came back online ─────────
      const onlineNeedsRecovery =
        (isOnline || liveTrajectory) &&
        (p.extStatus === "offline" ||
          (p.presenceBehavior === "lost_when_offline" && p.extStatus === "lost"));

      const pForCompute = onlineNeedsRecovery ? { ...p, extStatus: "green" as PaxExtStatus } : p;
      const computed0   = computePassenger(pForCompute, flight, gate);

      let extStatus: PaxExtStatus = computed0.extStatus as PaxExtStatus;
      if (onlineNeedsRecovery) {
        const s = computed0.status;
        extStatus = (s === "green" || s === "yellow" || s === "red") ? (s as PaxExtStatus) : "yellow";
      }

      const computed: PassengerComputed = { ...computed0, extStatus, rtOnline: isOnline || !!liveTrajectory };

      // Live PDR trajectory overlay
      if (trajectory?.position) {
        computed.location = trajectory.position;
        computed.activity = "moving";
        computed.path = trajectory.path?.length ? trajectory.path : [trajectory.position];
        computed.liveVideoGateHint = "Indoor video route (live)";
      }

      return computed;
    });
  }, [passengersRaw, gatesById, flightsById, presence, paxTrajectories]);

  // ── Selection / search ─────────────────────────────────────────────────────
  const [selectedPaxId, setSelectedPaxId] = useState<string | null>(null);
  const [hoverPaxId,    setHoverPaxId]    = useState<string | null>(null);
  const [search,        setSearch]        = useState("");
  const [mapViewMode,   setMapViewMode]   = useState<"all" | "single" | "urgent">("all");
  const [openConvPaxId, setOpenConvPaxId] = useState<string | null>(null);

  const passengersFilteredByGate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return passengers;
    return passengers.filter((p) => {
      const gateId = (p.gateId || "").toLowerCase();
      const gateName = (gatesById.get(p.gateId)?.name || "").toLowerCase();
      const name = (p.name || "").toLowerCase();
      const id = (p.id || "").toLowerCase();
      const flight = (p.flightId || "").toLowerCase();
      return (
        gateId.includes(q) ||
        gateName.includes(q) ||
        name.includes(q) ||
        id.includes(q) ||
        flight.includes(q)
      );
    });
  }, [passengers, search, gatesById]);

  const riskCounts: RiskCounts = useMemo(() => {
    const counts: RiskCounts = { green: 0, yellow: 0, red: 0, missed: 0, offline: 0, lost: 0 };
    for (const p of passengers) {
      const es = p.extStatus as keyof RiskCounts;
      if (es in counts) counts[es]++;
    }
    return counts;
  }, [passengers]);

  /** Priority list sorted by sortPriority, then risk level. */
  const priorityList = useMemo(() => {
    return passengers
      .filter(
        (p) =>
          ["lost", "red", "yellow", "missed"].includes(p.extStatus) ||
          p.transfer?.urgency === "urgent" ||
          (p.sortPriority != null && p.sortPriority <= 1)
      )
      .sort((a, b) => {
        // sortPriority field takes precedence
        const sp = (a.sortPriority ?? 99) - (b.sortPriority ?? 99);
        if (sp !== 0) return sp;

        const rank = (p: PassengerComputed) => {
          if (p.extStatus === "lost")   return 0;
          if (p.extStatus === "red")    return 1;
          if (p.transfer?.urgency === "urgent") return 2;
          if (p.extStatus === "yellow") return 3;
          if (p.extStatus === "missed") return 4;
          return 5;
        };
        return rank(a) - rank(b);
      })
      .slice(0, 12);
  }, [passengers]);

  // ── Map passengers ──────────────────────────────────────────────────────────
  const mapPassengers = useMemo(() => {
    const base  = passengersFilteredByGate;
    const byId  = new Map(base.map((p) => [p.id, p]));
    const liveIds     = Object.keys(paxTrajectories || {});
    const livePassengers = passengers.filter((p) => liveIds.includes(p.id));
    for (const lp of livePassengers) byId.set(lp.id, lp);

    if (mapViewMode === "single" && selectedPaxId) {
      const out: typeof base = [];
      const sel = byId.get(selectedPaxId);
      if (sel) out.push(sel);
      for (const lp of livePassengers) { if (!out.some((x) => x.id === lp.id)) out.push(lp); }
      return out;
    }
    if (mapViewMode === "urgent") {
      const urgentIds = new Set(priorityList.map((p) => p.id));
      const out = Array.from(byId.values()).filter((p) => urgentIds.has(p.id));
      for (const lp of livePassengers) { if (!out.some((x) => x.id === lp.id)) out.push(lp); }
      return out;
    }
    return Array.from(byId.values());
  }, [passengersFilteredByGate, mapViewMode, selectedPaxId, priorityList, paxTrajectories, passengers]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const sendSms = (pid: string, msg: string) => {
    const rt = rtRef.current;
    if (!rt || !rt.isConnected()) { pushToast("Message sent (mock)", msg); return; }
    rt.send(pid, msg, "Orienta Alert");
    pushToast("Message sent", `→ ${pid}: ${msg.slice(0, 60)}`);
  };

  const fetchChatHistoryHttp = useCallback(async (pid: string) => {
    try {
      const res = await fetch(
        apiUrl(
          `/api/orienta/admin-chat-history?tenant=${encodeURIComponent(tenantId)}&passengerId=${encodeURIComponent(pid)}`,
        ),
        { credentials: "same-origin" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        messages?: ChatMessage[];
      };
      if (!res.ok || !data.ok || !Array.isArray(data.messages)) return;
      setChatHistory((h) => ({ ...h, [pid]: mergeChatHistory(h[pid] || [], data.messages!) }));
    } catch {
      /* ignore */
    }
  }, [tenantId]);

  const sendChat = (pid: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    const msgId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const localMsg: ChatMessage = {
      id: msgId, passengerId: pid, tenantId, from: "admin", kind: "text", body: text,
      createdAt: Date.now(), status: "sending",
    };
    setChatHistory((h) => ({ ...h, [pid]: [...(h[pid] || []), localMsg].slice(-50) }));
    if (rtRef.current?.isConnected()) {
      rtRef.current.chatSend(pid, text, "text");
      setChatHistory((h) => ({
        ...h,
        [pid]: (h[pid] || []).map((m) => m.id === msgId ? { ...m, status: "sent" as const } : m),
      }));
      return;
    }
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/orienta/admin-chat-send"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, passengerId: pid, body: text, kind: "text" }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: ChatMessage;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.message) {
          setChatHistory((h) => ({
            ...h,
            [pid]: (h[pid] || []).filter((m) => m.id !== msgId),
          }));
          pushToast("Chat send failed", data.error || `HTTP ${res.status}`);
          return;
        }
        setChatHistory((h) => ({
          ...h,
          [pid]: upsertChatMessage(h[pid] || [], { ...data.message!, status: "sent" }),
        }));
      } catch (err) {
        setChatHistory((h) => ({
          ...h,
          [pid]: (h[pid] || []).filter((m) => m.id !== msgId),
        }));
        pushToast("Chat send failed", err instanceof Error ? err.message : "error");
      }
    })();
  };

  const requestLocation = (pid: string) => {
    rtRef.current?.requestLocation(pid);
    pushToast("Location requested", `Sent location request to ${pid}`);
  };

  const openConversation = (pid: string) => {
    setOpenConvPaxId(pid);
    rtRef.current?.fetchHistory(pid);
    void fetchChatHistoryHttp(pid);
  };

  // Keep open conversation fresh when WS is down (phone via trycloudflare).
  useEffect(() => {
    if (!openConvPaxId) return;
    void fetchChatHistoryHttp(openConvPaxId);
    const t = window.setInterval(() => void fetchChatHistoryHttp(openConvPaxId), 4_000);
    return () => window.clearInterval(t);
  }, [openConvPaxId, fetchChatHistoryHttp]);

  const postAdminRobot = async (passengerId: string, action: "advance" | "cancel") => {
    try {
      const res = await fetch(apiUrl("/api/orienta/admin-robot-request"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, passengerId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        request?: RobotRequest;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.request) {
        pushToast("Robot update failed", data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.request.status === "cancelled") {
        setRobotRequests((prev) => prev.filter((r) => r.passengerId !== passengerId));
      } else {
        upsertRobotRequest(passengerId, data.request);
      }
    } catch (err) {
      pushToast("Robot update failed", err instanceof Error ? err.message : "error");
    }
  };

  return {
    passengers, priorityList, riskCounts,
    passengersLoadError, passengersLastSyncAt,
    selectedPaxId, setSelectedPaxId,
    hoverPaxId, setHoverPaxId,
    search, setSearch,
    passengersFilteredByGate,
    mapPassengers, mapViewMode, setMapViewMode, paxTrajectories,
    rtUp, presence,
    openConvPaxId, setOpenConvPaxId,
    chatHistory, msgById,
    sendSms, sendChat, requestLocation, openConversation,
    toasts, dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    robotRequests,
    advanceRobotRequest: (pid) => void postAdminRobot(pid, "advance"),
    cancelRobotRequest: (pid) => void postAdminRobot(pid, "cancel"),
  };
}
