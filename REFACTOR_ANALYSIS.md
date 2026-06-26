# Orienta v2 Step2 — Refactor Analysis

> Generated: 2026-05-24  
> Branch analysed: `another-way-of-communicating-between-devices-PDR-recording`

---

## Overview

The codebase is a working PoC but has grown organically with significant structural debt:
hardcoded values, duplicated logic, monolithic files, and no tests.
This document catalogues every problem found and provides a prioritised refactor roadmap.

---

## Problems Found

### 1. 🏋️ Monolithic Files (God Objects)

| File | Lines | Problem |
|---|---|---|
| `vite/src/App.tsx` | **974** | 4 logical components + all app state in one file |
| `vite/wsHub.ts` | **642** | WebSocket routing + presence + chat + AI + trajectory all mixed |
| `vite/apiRoutes.ts` | **658** | Push notifications + FlightAware + MapKit + airport data all together |
| `vite/src/services/passengerSim.ts` + `passengerSimSFO.ts` | **421 + 430** | Near-identical files — should be one generic sim engine |

`App.tsx` contains four logical pieces that should each live in their own file:
- `App` (entry / route guard)
- `Dashboard` (main layout + all state)
- `DashboardTab` (passenger table)
- `RiskBadges` (pure display component)
- `statusBadge` / `extStatusLabel` utility functions

---

### 2. 🪄 Hardcoded Magic Passenger IDs in Business Logic

Specific passenger IDs are special-cased directly inside component render logic and sort comparators:

```tsx
// App.tsx lines 318–516 — inside useMemo:
if (p.id === "P8" && !isOnline && !liveTrajectory) { ... }  // "lost" override
if (p.id === "P11" && !isOnline) { ... }                    // "lost" override
if (p.id === "P11" && isOnline) { ... }                     // lounge pin override
if (a.id === "P8" && b.id !== "P8") return -1;              // sort order hardcoded
return (a.id === "TX3" ? -1 : 0) - (b.id === "TX3" ? -1 : 0);
```

Also in `vite/wsHub.ts`:
```ts
const PREMIUM_IDS = new Set(["TX1", "TX2", "TX3", "SP1", "SP2", ..., "P11", "P15", "P21", "P27"]);
```

**Impact:** Changing a demo scenario requires hunting through 6+ files.
The right fix is to encode these behaviours as fields in the passenger scenario data object.

---

### 3. 📦 Duplicate Type Definitions

`ChatMessage`, `ChatKind`, `MsgRecord`, `MsgStatus` are defined **three times** independently:

| File | Types defined |
|---|---|
| `vite/src/services/types.ts` | `ChatMessage`, `ChatKind` (partial — missing `status`, `deliveredAt`, `readAt`) |
| `vite/src/services/realtime.ts` | `ChatMessage`, `ChatKind`, `MsgRecord`, `MsgStatus`, `ChatMsgStatus` |
| `vite/wsHub.ts` | `ChatMessage`, `ChatKind`, `MsgRecord`, `MsgStatus` |

The three definitions have **silently diverged**: `types.ts`'s `ChatMessage` is missing fields
that `realtime.ts` adds, which leads to runtime `(computed as any)` casts to paper over the gaps.

---

### 4. 🗺️ Coordinate Data Duplicated Across Files

**PEK T3E gate coordinates appear twice:**
- `vite/apiRoutes.ts` — `GATE_COORDS["PEK"]` (36 gates, hardcoded `[lat, lng]` tuples)
- `vite/src/services/pekPoiCoords.ts` — fetched from indoor map API, with static fallback cache

**SFO gate coordinates appear twice:**
- `vite/src/services/passengerSimSFO.ts` — `SFO_GATE_COORDS` (100+ gates, accurate)
- `vite/apiRoutes.ts` — `GATE_COORDS["SFO"]` (only 14 gates — a stale, incomplete subset)

**Airport centres duplicated:**
- `passengerSimSFO.ts` → `SFO_CENTER`
- `apiRoutes.ts` → `AIRPORT_CENTERS`

**Fix:** Single `airports/pek.ts` and `airports/sfo.ts` config files imported everywhere.

---

### 5. 🔁 Near-Identical Simulation Engines

`passengerSim.ts` (PEK) and `passengerSimSFO.ts` (SFO) independently define:

```ts
// Identical in both files:
function offsetMs(minutes: number): string { ... }
function randomNearby(p: LatLng, radius: number): LatLng { ... }

// Identical algorithm, just different speed/distance constants:
export function stepWorld(...)     // PEK — 1.20 m/s, gate threshold 20 m
export function stepSFOWorld(...)  // SFO — 1.15 m/s, gate threshold 15 m
```

The only real differences are: walking speed, gate-arrival threshold, bbox/clamp bounds,
and the static scenario/profile datasets.

**Fix:** One generic `SimEngine` parameterised by an `AirportConfig` object.

---

### 6. 🔐 Secrets and Build Artifacts Tracked in Git

```
vite/AuthKey_Q995889V4H.p8       ← Apple private key committed to git ⚠️
scripts/__pycache__/*.pyc         ← Python bytecache committed
vite/dist/                        ← Built frontend assets committed
```

`.env.example` contains **live credentials** (not placeholder values):
```
FLIGHTAWARE_API_KEY=DWJmVBsQwpPWSH53OCi0dOKgAQlWiCcL   ← real key
APPLE_TEAM_ID="SU5XY9A9GF"
APPLE_KEY_ID="Q995889V4H"
```

**Action required before opening new repo:**
1. Rotate all keys that have ever been committed.
2. Add `*.p8`, `vite/dist/`, `scripts/__pycache__/`, `**/__pycache__/` to `.gitignore`.
3. Replace `.env.example` values with `YOUR_KEY_HERE` placeholders.

---

### 7. 🔓 Client-Side Mock Auth with Hardcoded Passwords

`vite/src/services/auth.ts` embeds credentials in the JavaScript bundle:

```ts
const ok1 = (u === "admin@airchina.com") && p === "orienta123";
const ok2 = (u === "ops@airchina.com")   && p === "orienta123";
const ok3 =  u === "demo"                && p === "demo";
```

Anyone who opens DevTools → Sources can read `orienta123`.
The session token is a random string stored unencrypted in `localStorage` — no server validation.

**Fix:** Move auth to the server. Even for a demo, a single `POST /api/auth/login`
that checks a secret env var and returns a signed JWT is straightforward and safe.

---

### 8. 🌐 Fragile Global Singleton Pattern in `wsHub.ts`

Module-level `null` function pointers are the only bridge from HTTP routes → WebSocket hub:

```ts
let routeSitePushImpl:        ((a: ...) => boolean) | null = null;
let paxChatHttpSendImpl:      ((...) => ChatMessage | null) | null = null;
let listOnlinePassengerIdsImpl: ((tenantId: string) => string[]) | null = null;
let setPaxPresenceImpl:        ((tid, pid, online) => void) | null = null;
```

These are `null` until `attachWsHub()` is called.
Calling it twice (hot-reload, test isolation) silently drops the previous implementation.
Impossible to unit-test without starting a real HTTP server.

**Fix:** Inject a shared `HubStore` instance (or simple EventEmitter) into both
`registerApiRoutes` and `attachWsHub` rather than using module-level singletons.

---

### 9. 📐 Routing Logic Inside Component Render (Hooks Violation)

`App.tsx` checks `window.location.pathname` and calls side-effect functions **before hooks**:

```tsx
export default function App() {
  if (typeof window !== "undefined") {
    normalizeLoungePathToPax();             // side effect before any hooks!
    if (window.location.pathname === "/pax") {
      return <PaxEntryWrapper />;           // early return before hooks!
    }
  }
  const [session, setSession] = useState(...)   // hooks after conditional return
```

This violates the React Rules of Hooks (hooks must not be called conditionally)
and bypasses any router abstraction.

---

### 10. 🎨 All Styling Is Inline

Nearly every layout and colour value in `App.tsx`, `DashboardTab`, `ConversationPanel`, etc.
is written as an inline `style={}` object — hundreds of them.
This makes theming, responsive breakpoints, and dark/light mode practically impossible.

---

### 11. 🔢 Chaotic Env Variable Naming

The same credential is addressable via multiple names:

| Canonical name | Legacy / alias |
|---|---|
| `APPLE_TEAM_ID` | `VITE_MAPKIT_TEAM_ID` |
| `APPLE_KEY_ID` | `VITE_MAPKIT_KEY_ID` |
| `VITE_INDOOR_MAP_URL` | `VITE_ROUTE_SITE_INDOOR_MAP_URL` (deprecated, still read) |
| `VITE_INDOOR_MAP_API_BASE` | `VITE_ROUTE_SITE_INDOOR_MAP_API_BASE` (deprecated, still read) |

`PDR_API_ORIGIN` must NOT end in `/api` — a bug so common it needed a runtime normaliser
(`normalizePdrApiOrigin` in `server.ts`) rather than just clear documentation.

No central config validation: missing vars fail silently at runtime.

**Fix:** Single `config.ts` (server-side) that reads, validates, and exports all env vars.
Crash-fast at startup with a clear message if a required var is missing.

---

### 12. 🧪 Zero Tests

No test files, no `vitest.config.ts`, no `jest.config`.
The simulation engine, ETA computation, presence state machine, and WebSocket message
routing all have zero test coverage.

**Highest-value first tests to write:**
1. `computePassenger` — pure function, many edge cases (missed/offline/lost/at_gate/ETA)
2. `stepWorld` — pure function, movement and gate-arrival logic
3. `resolveCanonicalPassengerId` — alias mapping
4. WsHub presence state transitions

---

### 13. 🏗️ Hard Relative Paths Assume Fixed Directory Layout

`vite/server.ts` uses `__dirname`-relative paths to reach sibling directories:

```ts
const repoAirportMapPath  = path.join(__dirname, "../../airport-map.html");
const localIndoorMapApiDir = path.join(__dirname, "../indoor-map-api");
const localIndoorMapTilesDir = path.join(__dirname, "../indoor-map-tiles");
```

These break silently if the `vite/` folder is moved or the repo is restructured.

---

### 14. 💣 `any` Types in Core Data Flow

The primary state that drives the entire dashboard has no type:

```tsx
const [passengersRaw, setPassengersRaw] = useState<any>(null);
const list = passengersRaw.passengers.map((p: any) => { ... });
(computed as any).rtOnline = isOnline || liveTrajectory;
(computed as any).location = trajectory.position as LatLng;
```

---

## Priority Refactor Roadmap

### 🔴 Critical — Do Before Opening New Repo

| # | Action |
|---|---|
| C1 | Remove `AuthKey_Q995889V4H.p8` from git (BFG / `git filter-repo`) and rotate the key |
| C2 | Replace real keys in `.env.example` with `YOUR_KEY_HERE` placeholders |
| C3 | Add `*.p8`, `vite/dist/`, `**/__pycache__/` to `.gitignore` |

### 🟠 High — Architecture

| # | Area | Action |
|---|---|---|
| H1 | Types | Single `src/types/` folder; `wsHub.ts` and `realtime.ts` re-export from it |
| H2 | `App.tsx` | Split into `App.tsx` (router), `Dashboard.tsx`, `DashboardTab.tsx`, `RiskBadges.tsx`, `useDashboard.ts` hook |
| H3 | Sim engine | Merge PEK + SFO into `SimEngine(airportConfig)` parameterised by speed, bbox, scenarios |
| H4 | Airport data | `src/airports/pek.ts` + `src/airports/sfo.ts` as single source for coords/flights/scenarios |
| H5 | Auth | Server-side `POST /api/auth/login` checking env var secret; JWT response |
| H6 | `wsHub.ts` | Inject `HubStore` class instead of module-level singletons; split into sub-modules |

### 🟡 Medium — Developer Experience

| # | Area | Action |
|---|---|---|
| M1 | Env config | `server/config.ts` — validate + export all vars; fail-fast with clear error |
| M2 | Hardcoded IDs | Encode P8/P11 special behaviours as fields in scenario data (`pinBehavior`, `presenceBehavior`) |
| M3 | Routing | React Router v6 or simple `<Switch>` — remove pathname checks from component body |
| M4 | Paths | `server/paths.ts` with all resolved directories; no `../../` chains |

### 🟢 Low — Polish

| # | Area | Action |
|---|---|---|
| L1 | Styling | CSS modules or Tailwind; remove inline `style={}` objects |
| L2 | Tests | Vitest for `computePassenger`, `stepWorld`, `resolveCanonicalPassengerId` |
| L3 | Env naming | Deprecate `VITE_MAPKIT_*` aliases; standardise on `APPLE_*` / `VITE_*` |

---

## Suggested New Repo Structure

```
orienta-v2/
├── apps/
│   └── dashboard/              # Vite + React frontend (was vite/)
│       ├── src/
│       │   ├── app/            # App, Dashboard, router
│       │   ├── components/     # UI components
│       │   ├── features/
│       │   │   ├── passengers/ # PassengerCard, PassengerList, useDashboard
│       │   │   ├── map/        # MapView, adapters
│       │   │   ├── chat/       # ConversationPanel, ChatDrawer
│       │   │   └── fids/       # FidsPanel
│       │   ├── sim/            # Generic SimEngine + airport configs
│       │   │   ├── engine.ts
│       │   │   ├── airports/
│       │   │   │   ├── pek.ts  # PEK coords, flights, scenarios
│       │   │   │   └── sfo.ts  # SFO coords, flights, scenarios
│       │   └── types/          # Single source of truth for all types
│       └── server/             # Express server, wsHub, apiRoutes
│           ├── config.ts       # Env var validation
│           ├── hub/            # WsHub split: presence, chat, trajectory
│           └── routes/         # API routes split by domain
├── packages/
│   └── pdr/                    # Python PDR backend (was pdr_airchina/)
└── scripts/                    # Build, deploy, video concat scripts
```

---

*End of analysis — see git history of `orienta_v2_step2` for original context.*

claude --resume 86be072e-2d57-40a4-8d17-06af1369022b
