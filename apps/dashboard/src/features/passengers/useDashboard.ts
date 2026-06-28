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

export type ToastItem = { id: string; title: string; body: string };

export type DashboardState = {
  // Passengers
  passengers: PassengerComputed[];
  priorityList: PassengerComputed[];
  riskCounts: Record<string, number>;

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

  const loadPassengers = useCallback(async () => {
    try {
      const r = await fetch(apiUrl(`/api/passengers?tenant=${encodeURIComponent(tenantId)}`));
      if (!r.ok) { setPassengersRaw((w) => w ?? { passengers: [] }); return; }
      const j = await r.json();
      if (!j.ok || !Array.isArray(j.passengers)) { setPassengersRaw((w) => w ?? { passengers: [] }); return; }
      setPassengersRaw((prev) => {
        if (!prev) return { passengers: j.passengers as Passenger[] };
        const existing = new Map(prev.passengers.map((p) => [p.id, p]));
        const merged = (j.passengers as Passenger[]).map((p) => existing.get(p.id) ?? p);
        return { passengers: merged };
      });
    } catch {
      setPassengersRaw((w) => w ?? { passengers: [] });
    }
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
  }, [pekPoiReady, loadPassengers]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const pushToast = (title: string, body: string) => {
    const id = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t.slice(-4), { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };

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
        setChatHistory((h) => ({ ...h, [msg.passengerId]: [...(h[msg.passengerId] || []), msg].slice(-50) }));
      },
      onChatHistory: (pid: string, msgs: ChatMessage[]) => {
        setChatHistory((h) => ({ ...h, [pid]: msgs }));
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
    });
    rtRef.current = rt;
    return () => { rtRef.current = null; rt.close(); };
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setPresence((m) => {
          let changed = false;
          const next = { ...m };
          for (const id of j.online as string[]) {
            if (!next[id]) { next[id] = true; changed = true; }
          }
          return changed ? next : m;
        });
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
      const gateId  = (p.gateId || "").toLowerCase();
      const gateName = (gatesById.get(p.gateId)?.name || "").toLowerCase();
      return gateId.includes(q) || gateName.includes(q);
    });
  }, [passengers, search, gatesById]);

  const riskCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, missed: 0, offline: 0, lost: 0 };
    for (const p of passengers) {
      const es = p.extStatus as keyof typeof counts;
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

  const sendChat = (pid: string, body: string) => {
    const msgId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const localMsg: ChatMessage = {
      id: msgId, passengerId: pid, tenantId, from: "admin", kind: "text", body,
      createdAt: Date.now(), status: "sending",
    };
    setChatHistory((h) => ({ ...h, [pid]: [...(h[pid] || []), localMsg].slice(-50) }));
    if (rtRef.current?.isConnected()) {
      rtRef.current.chatSend(pid, body, "text");
      setChatHistory((h) => ({
        ...h,
        [pid]: (h[pid] || []).map((m) => m.id === msgId ? { ...m, status: "sent" as const } : m),
      }));
    }
  };

  const requestLocation = (pid: string) => {
    rtRef.current?.requestLocation(pid);
    pushToast("Location requested", `Sent location request to ${pid}`);
  };

  const openConversation = (pid: string) => {
    setOpenConvPaxId(pid);
    rtRef.current?.fetchHistory(pid);
  };

  return {
    passengers, priorityList, riskCounts,
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
  };
}
