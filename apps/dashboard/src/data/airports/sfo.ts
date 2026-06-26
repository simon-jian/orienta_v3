/**
 * SFO airport data — geographic constants, static flight list, gate lookup.
 * No sim-engine imports; safe to use from both frontend and server.
 */
import type { Flight, Gate, Passenger, PaxExtStatus, PaxPlan } from "../../types/types";

// ─── Geography ────────────────────────────────────────────────────────────────

export const SFO_CENTER = { lat: 37.6155, lng: -122.3866 };

export const SFO_BBOX = {
  minLat: 37.609, maxLat: 37.622,
  minLng: -122.394, maxLng: -122.380,
};

export const SFO_GATE_COORDS: Record<string, { lat: number; lng: number }> = {
  // Terminal A (International)
  A1:  { lat: 37.6139105, lng: -122.388314  }, A2:  { lat: 37.613345,  lng: -122.388689  },
  A3:  { lat: 37.6138967, lng: -122.389051  }, A4:  { lat: 37.6133353, lng: -122.389423  },
  A5:  { lat: 37.613297,  lng: -122.389449  }, A6:  { lat: 37.6126511, lng: -122.3891497 },
  A7:  { lat: 37.6126175, lng: -122.3891717 }, A8:  { lat: 37.6120777, lng: -122.3895301 },
  A9:  { lat: 37.612891,  lng: -122.3897184 }, A10: { lat: 37.6123205, lng: -122.3900962 },
  A11: { lat: 37.6115083, lng: -122.389907  }, A12: { lat: 37.6117474, lng: -122.3904762 },
  A13: { lat: 37.6114751, lng: -122.389961  }, A14: { lat: 37.6114954, lng: -122.3900098 },
  A15: { lat: 37.6116737, lng: -122.390432  },
  // Terminal B (Domestic/United)
  B1:  { lat: 37.6142595, lng: -122.387189  }, B2:  { lat: 37.6141152, lng: -122.3867838 },
  B3:  { lat: 37.6138443, lng: -122.3844905 }, B4:  { lat: 37.6138146, lng: -122.3858342 },
  B5:  { lat: 37.6137536, lng: -122.3855861 }, B6:  { lat: 37.6133097, lng: -122.3842839 },
  B7:  { lat: 37.6132188, lng: -122.3842482 }, B8:  { lat: 37.6131016, lng: -122.3842026 },
  B9:  { lat: 37.6126624, lng: -122.3844362 }, B10: { lat: 37.612686,  lng: -122.3853426 },
  B11: { lat: 37.6126574, lng: -122.3852734 }, B12: { lat: 37.6123327, lng: -122.3846534 },
  B13: { lat: 37.6119697, lng: -122.3848928 }, B14: { lat: 37.6116407, lng: -122.3851137 },
  B15: { lat: 37.6119298, lng: -122.3858655 }, B16: { lat: 37.61189,   lng: -122.3857692 },
  B17: { lat: 37.6112994, lng: -122.3853356 }, B18: { lat: 37.6109898, lng: -122.385538  },
  B19: { lat: 37.6112011, lng: -122.3861094 }, B20: { lat: 37.6111525, lng: -122.3861415 },
  B21: { lat: 37.6106442, lng: -122.3857662 }, B22: { lat: 37.6104637, lng: -122.3859687 },
  B23: { lat: 37.610541,  lng: -122.3861554 }, B24: { lat: 37.6105618, lng: -122.3862059 },
  B25: { lat: 37.6106399, lng: -122.3863946 }, B26: { lat: 37.6108309, lng: -122.386353  },
  B27: { lat: 37.6108663, lng: -122.3863296 },
  // Terminal C
  C1:  { lat: 37.6143662, lng: -122.3844282 }, C2:  { lat: 37.6151137, lng: -122.3836368 },
  C3:  { lat: 37.6154258, lng: -122.3834354 }, C4:  { lat: 37.614918,  lng: -122.3831621 },
  C5:  { lat: 37.6152241, lng: -122.3829604 }, C6:  { lat: 37.6147424, lng: -122.382744  },
  C7:  { lat: 37.6149848, lng: -122.3824714 }, C8:  { lat: 37.6146456, lng: -122.3825244 },
  C9:  { lat: 37.6149534, lng: -122.3823151 }, C10: { lat: 37.6146266, lng: -122.3822612 },
  C11: { lat: 37.6147998, lng: -122.3821517 },
  // Terminal D
  D1:  { lat: 37.616984,  lng: -122.3824875 }, D3:  { lat: 37.6170847, lng: -122.3816809 },
  D4:  { lat: 37.6169608, lng: -122.3813831 }, D5:  { lat: 37.6168198, lng: -122.3810409 },
  D6:  { lat: 37.616845,  lng: -122.3809902 }, D7:  { lat: 37.6170606, lng: -122.3808478 },
  D8:  { lat: 37.6174275, lng: -122.3809236 }, D9:  { lat: 37.6175704, lng: -122.381054  },
  D10: { lat: 37.6179179, lng: -122.3810883 }, D11: { lat: 37.6181624, lng: -122.3812575 },
  D12: { lat: 37.6182643, lng: -122.3814952 }, D14: { lat: 37.6181645, lng: -122.3816964 },
  D15: { lat: 37.6179305, lng: -122.3818448 }, D16: { lat: 37.6176549, lng: -122.3819234 },
  // Terminal E (International)
  E2:  { lat: 37.6186927, lng: -122.3860034 }, E3:  { lat: 37.618592,  lng: -122.385449  },
  E4:  { lat: 37.6181607, lng: -122.3847474 }, E5:  { lat: 37.6184855, lng: -122.3844676 },
  E6:  { lat: 37.6187948, lng: -122.3848896 }, E7:  { lat: 37.6188612, lng: -122.3841941 },
  E8:  { lat: 37.61922,   lng: -122.3845289 }, E9:  { lat: 37.6191222, lng: -122.3839579 },
  E10: { lat: 37.6194657, lng: -122.3844449 }, E11: { lat: 37.6193959, lng: -122.383884  },
  E12: { lat: 37.619561,  lng: -122.3842754 }, E13: { lat: 37.6194536, lng: -122.3840393 },
  // Terminal F (International)
  F5:  { lat: 37.6199654, lng: -122.3871133 }, F6:  { lat: 37.6203285, lng: -122.3871137 },
  F7:  { lat: 37.6205623, lng: -122.3869537 }, F8:  { lat: 37.6206985, lng: -122.3868604 },
  F9:  { lat: 37.6207473, lng: -122.3870803 }, F10: { lat: 37.6208193, lng: -122.3867823 },
  F11: { lat: 37.6202588, lng: -122.3878267 }, F12: { lat: 37.6200532, lng: -122.3882767 },
  F13: { lat: 37.6205535, lng: -122.3885186 }, F14: { lat: 37.6202912, lng: -122.3888444 },
  F15: { lat: 37.6208347, lng: -122.3891944 }, F16: { lat: 37.6205238, lng: -122.3893994 },
  F17: { lat: 37.6207622, lng: -122.3899683 }, F18: { lat: 37.6207801, lng: -122.3900107 },
  F19: { lat: 37.6209417, lng: -122.3903166 }, F20: { lat: 37.6210921, lng: -122.3902859 },
  F21: { lat: 37.6211911, lng: -122.3901757 }, F22: { lat: 37.6211502, lng: -122.3898735 },
  // Terminal G (Domestic)
  G1:  { lat: 37.6173605, lng: -122.3895    }, G2:  { lat: 37.6176476, lng: -122.390253  },
  G3:  { lat: 37.6174329, lng: -122.391098  }, G4:  { lat: 37.6177357, lng: -122.391818  },
  G5:  { lat: 37.6179453, lng: -122.390962  }, G6:  { lat: 37.6182478, lng: -122.391683  },
  G7:  { lat: 37.6180321, lng: -122.392527  }, G8:  { lat: 37.6183349, lng: -122.393248  },
  G9:  { lat: 37.618476,  lng: -122.392245  }, G10: { lat: 37.6187813, lng: -122.392954  },
  "G11-G12": { lat: 37.6185378, lng: -122.3934748 },
  "G13-G14": { lat: 37.618814,  lng: -122.393292  },
};

// ─── Flights ──────────────────────────────────────────────────────────────────

export const SFO_INBOUND_FLIGHTS = [
  { id: "B6133",  callsign: "B6 133",  from: "JFK", arr: 0,  gate: "B3"  },
  { id: "UA388",  callsign: "UA 388",  from: "NRT", arr: 10, gate: "F12" },
  { id: "CX872",  callsign: "CX 872",  from: "HKG", arr: 20, gate: "F7"  },
  { id: "LH456",  callsign: "LH 456",  from: "FRA", arr: 5,  gate: "A8"  },
  { id: "AA202",  callsign: "AA 202",  from: "LAX", arr: 15, gate: "B15" },
  { id: "DL1002", callsign: "DL 1002", from: "ATL", arr: 30, gate: "B22" },
  { id: "QF74",   callsign: "QF 74",   from: "SYD", arr: 8,  gate: "F18" },
  { id: "SQ1",    callsign: "SQ 1",    from: "SIN", arr: 12, gate: "F5"  },
] as const;

export const SFO_OUTBOUND_FLIGHTS = [
  { id: "CA986",  callsign: "CA 986",  to: "PEK", dep: 90, gate: "G13-G14" },
  { id: "UA235",  callsign: "UA 235",  to: "ORD", dep: 60, gate: "G5"      },
  { id: "AA302",  callsign: "AA 302",  to: "DFW", dep: 45, gate: "G3"      },
  { id: "DL504",  callsign: "DL 504",  to: "JFK", dep: 75, gate: "G7"      },
  { id: "WN400",  callsign: "WN 400",  to: "LAS", dep: 30, gate: "D5"      },
  { id: "AS712",  callsign: "AS 712",  to: "SEA", dep: 55, gate: "D10"     },
  { id: "B6244",  callsign: "B6 244",  to: "BOS", dep: 80, gate: "C6"      },
  { id: "NK332",  callsign: "NK 332",  to: "LAX", dep: 25, gate: "C10"     },
  { id: "F9900",  callsign: "F9 900",  to: "DEN", dep: 40, gate: "B12"     },
  { id: "G4511",  callsign: "G4 511",  to: "PHX", dep: 35, gate: "D8"      },
] as const;

export const SFO_FLIGHT_GATE_MAP: Record<string, string> = {
  B6133: "B3", "B6 133": "B3", UA388: "F12", "UA 388": "F12",
  CX872: "F7", "CX 872": "F7", LH456: "A8",  "LH 456": "A8",
  AA202: "B15", "AA 202": "B15", DL1002: "B22", "DL 1002": "B22",
  QF74: "F18", "QF 74": "F18", SQ1: "F5", "SQ 1": "F5",
  CA986: "G13-G14", "CA 986": "G13-G14",
  UA235: "G5",  "UA 235": "G5",  AA302: "G3",  "AA 302": "G3",
  DL504: "G7",  "DL 504": "G7",  WN400: "D5",  "WN 400": "D5",
  AS712: "D10", "AS 712": "D10", B6244: "C6",  "B6 244": "C6",
  NK332: "C10", "NK 332": "C10", F9900: "B12", "F9 900": "B12",
  G4511: "D8",  "G4 511": "D8",
};

// ─── Premium IDs ──────────────────────────────────────────────────────────────

export const SFO_PREMIUM_IDS = new Set([
  "TX1", "TX2", "TX3", "SP1", "SP2", "SP3", "SP4", "FP5",
]);

// ─── Gate / flight builders ───────────────────────────────────────────────────

export function buildSFOGates(): Gate[] {
  return Object.entries(SFO_GATE_COORDS).map(([id, coordinate]) => ({
    id, name: id, coordinate,
  }));
}

export function buildSFOFlights(): Flight[] {
  return SFO_OUTBOUND_FLIGHTS.map((f) => ({
    id: f.id, callsign: f.callsign, destination: f.to,
    scheduledDep: new Date(Date.now() + f.dep * 60_000).toISOString(),
    gateId: f.gate, gateRef: f.gate,
    status: "Gate Open" as const,
  }));
}

// ─── Static passenger snapshot (no sim movement) ─────────────────────────────

type SfoPassengerSpec = {
  id: string; name: string; nat: string; locale: string;
  plan: PaxPlan; wheelchair: boolean;
  extStatus: PaxExtStatus;
  activity: Passenger["activity"];
  outboundIdx: number; inboundIdx: number;
  note: string;
  sortPriority?: number;
};

const SFO_PAX_SPECS: SfoPassengerSpec[] = [
  { id: "TX1",  name: "Siyao Fu",         nat: "CN", locale: "zh-CN", plan: "premium", wheelchair: false, extStatus: "offline", activity: "idle",     outboundIdx: 0, inboundIdx: 0, note: "SIYAO FU — Transfer B6 133 (B3) → CA 986 (G13)" },
  { id: "TX2",  name: "David Kim",        nat: "KR", locale: "ko-KR", plan: "premium", wheelchair: false, extStatus: "yellow",  activity: "moving",   outboundIdx: 1, inboundIdx: 1, note: "Moving to gate G5 — tight connection" },
  { id: "TX3",  name: "Yan Jiang",        nat: "CN", locale: "zh-CN", plan: "premium", wheelchair: false, extStatus: "red",     activity: "dining",   outboundIdx: 4, inboundIdx: 1, note: "At risk — Final Call flight, still dining", sortPriority: 0 },
  { id: "SP1",  name: "Emma Reynolds",    nat: "GB", locale: "en-GB", plan: "premium", wheelchair: false, extStatus: "green",   activity: "moving",   outboundIdx: 2, inboundIdx: 2, note: "On track to C6" },
  { id: "SP2",  name: "Marco Ricci",      nat: "IT", locale: "it-IT", plan: "premium", wheelchair: true,  extStatus: "green",   activity: "at_gate",  outboundIdx: 3, inboundIdx: 3, note: "♿ At gate G3 with assistance" },
  { id: "SP3",  name: "Yuki Tanaka",      nat: "JP", locale: "ja-JP", plan: "premium", wheelchair: false, extStatus: "green",   activity: "moving",   outboundIdx: 4, inboundIdx: 4, note: "Moving to F18" },
  { id: "SP4",  name: "Priya Nair",       nat: "IN", locale: "en-IN", plan: "premium", wheelchair: false, extStatus: "red",     activity: "shopping", outboundIdx: 5, inboundIdx: 5, note: "At Duty Free — final call DL504" },
  { id: "FP1",  name: "Lucas Martin",    nat: "FR", locale: "fr-FR", plan: "free",    wheelchair: false, extStatus: "green",   activity: "moving",   outboundIdx: 6, inboundIdx: 6, note: "Moving to G7" },
  { id: "FP2",  name: "Aisha Hassan",    nat: "EG", locale: "ar-EG", plan: "free",    wheelchair: false, extStatus: "yellow",  activity: "dining",   outboundIdx: 7, inboundIdx: 7, note: "Dining — tight window" },
  { id: "FP3",  name: "Carlos Vega",     nat: "MX", locale: "es-MX", plan: "free",    wheelchair: false, extStatus: "offline", activity: "idle",     outboundIdx: 0, inboundIdx: 8, note: "No network — European SIM" },
  { id: "FP4",  name: "Sophie Dubois",   nat: "FR", locale: "fr-FR", plan: "free",    wheelchair: false, extStatus: "green",   activity: "at_gate",  outboundIdx: 1, inboundIdx: 9, note: "At gate D10 waiting" },
  { id: "FP5",  name: "Yan Jiang",       nat: "CN", locale: "zh-CN", plan: "premium", wheelchair: false, extStatus: "lost",    activity: "idle",     outboundIdx: 2, inboundIdx: 0, note: "Location lost in B terminal" },
  { id: "FP6",  name: "Min-ji Lee",      nat: "KR", locale: "ko-KR", plan: "free",    wheelchair: false, extStatus: "offline", activity: "idle",     outboundIdx: 3, inboundIdx: 1, note: "Korean SIM offline" },
  { id: "FP7",  name: "Ahmed Al-Sayed",  nat: "SA", locale: "ar-SA", plan: "free",    wheelchair: false, extStatus: "green",   activity: "moving",   outboundIdx: 4, inboundIdx: 2, note: "Moving to AA302 gate" },
  { id: "FP8",  name: "Zara Williams",   nat: "AU", locale: "en-AU", plan: "free",    wheelchair: true,  extStatus: "green",   activity: "moving",   outboundIdx: 5, inboundIdx: 3, note: "♿ Moving with assistance" },
  { id: "FP9",  name: "Henrik Larsen",   nat: "DK", locale: "da-DK", plan: "free",    wheelchair: false, extStatus: "missed",  activity: "idle",     outboundIdx: 6, inboundIdx: 4, note: "Flight WN400 already departed" },
  { id: "FP10", name: "Ana Silva",       nat: "BR", locale: "pt-BR", plan: "free",    wheelchair: false, extStatus: "green",   activity: "moving",   outboundIdx: 7, inboundIdx: 5, note: "Moving to AS712 gate" },
  { id: "FP11", name: "Thomas Weber",    nat: "DE", locale: "de-DE", plan: "free",    wheelchair: false, extStatus: "yellow",  activity: "idle",     outboundIdx: 0, inboundIdx: 6, note: "Resting near B terminal" },
  { id: "FP12", name: "Sara Johansson",  nat: "SE", locale: "sv-SE", plan: "free",    wheelchair: false, extStatus: "green",   activity: "at_gate",  outboundIdx: 1, inboundIdx: 7, note: "At gate D8 early" },
];

export function buildSFOPassengers(): Passenger[] {
  return SFO_PAX_SPECS.map((spec) => {
    const outbound = SFO_OUTBOUND_FLIGHTS[spec.outboundIdx];
    const inbound  = SFO_INBOUND_FLIGHTS[spec.inboundIdx % SFO_INBOUND_FLIGHTS.length];
    const coord    = outbound ? (SFO_GATE_COORDS[outbound.gate] ?? SFO_CENTER) : SFO_CENTER;
    const urgency: "urgent" | "normal" = outbound && outbound.dep <= 30 ? "urgent" : "normal";
    const now = Date.now();
    return {
      id: spec.id, name: spec.name, nationality: spec.nat,
      locale: spec.locale, plan: spec.plan, needsWheelchair: spec.wheelchair,
      flightId: outbound?.id ?? "", gateId: outbound?.gate ?? "",
      location: coord,
      activity: spec.activity, extStatus: spec.extStatus,
      transfer: {
        direction: "intl_to_dom" as const, urgency,
        inboundFlight: inbound?.id ?? "—", inboundFrom: inbound?.from ?? "—",
        inboundArr: new Date(now - (inbound?.arr ?? 0) * 60_000).toISOString(),
        outboundFlight: outbound?.id ?? "—", outboundTo: outbound?.to ?? "—",
        outboundDep: outbound ? new Date(now + outbound.dep * 60_000).toISOString() : new Date(now).toISOString(),
        note: spec.note,
      },
      presenceBehavior: "default" as const,
      sortPriority: spec.sortPriority ?? 99,
    };
  });
}

// ─── Simulator panel (Dashboard sidebar) ─────────────────────────────────────

export const SFO_SIM_PAX = [
  { id: "TX3", name: "Yan Jiang",    plan: "Premium", note: "At Risk" },
  { id: "TX1", name: "Siyao Fu",     plan: "Premium", note: "Offline初始 · 需登录" },
  { id: "TX2", name: "David Kim",    plan: "Premium", note: "Moving · Tight" },
  { id: "FP1", name: "Lucas Martin", plan: "Free",    note: "AI agent only" },
  { id: "FP5", name: "Yan Jiang",    plan: "Premium", note: "Location Lost" },
] as const;
