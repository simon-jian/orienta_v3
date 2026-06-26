# Orienta v3 — Codebase Overview

> Last updated: 2026-05-31

---

## What Was Refactored (v2 → v3)

### H1 · Types consolidated
**Problem:** `ChatMessage`, `ChatKind`, `MsgRecord`, `MsgStatus` were defined three times
independently in `types.ts`, `realtime.ts`, and `wsHub.ts`. The three copies had silently
diverged, requiring `as any` casts to paper over the gaps.

**Fix:** Single `src/types/types.ts` — all shared types in one place. Server and client both
import from it.

---

### H2 · Monolithic App.tsx split
**Problem:** `App.tsx` was 974 lines containing four logical pieces: route guard, full dashboard
layout, passenger table, and risk badges. All app state lived in one file.

**Fix:**
- `src/app/App.tsx` — route guard only
- `src/app/Dashboard.tsx` — layout
- `src/features/passengers/DashboardTab.tsx` — passenger table
- `src/features/passengers/RiskBadges.tsx` — risk count badges
- `src/features/passengers/useDashboard.ts` — all state logic extracted into a hook

---

### H3 · Duplicate sim engines merged
**Problem:** `passengerSim.ts` (PEK) and `passengerSimSFO.ts` (SFO) were 420-line
near-identical files. `offsetMs`, `randomNearby`, `stepWorld` were copy-pasted between them.
The only real differences were walking speed, gate threshold, and static data.

**Fix:** Single generic `src/sim/engine.ts` parameterised by `AirportConfig`. Airport-specific
constants live in `sim/airports/pek.ts` and `sim/airports/sfo.ts`.

---

### H4 · Coordinate data deduplicated
**Problem:** PEK gate coordinates appeared in both `apiRoutes.ts` and `pekPoiCoords.ts`. SFO
gate coordinates appeared in both `passengerSimSFO.ts` (100+ accurate gates) and `apiRoutes.ts`
(14 stale gates — an incomplete subset). Airport centres were duplicated across three files.

**Fix:** `sim/airports/pek.ts` and `sim/airports/sfo.ts` are the single source for all
coordinates, flights, profiles, and scenarios. Both the sim engine and the API routes import
from these files.

---

### H5 · Client-side mock auth replaced
**Problem:** `src/services/auth.ts` embedded plaintext passwords in the JS bundle:
```ts
const ok1 = (u === "admin@airchina.com") && p === "orienta123";
```
Anyone could read `orienta123` in DevTools → Sources.

**Fix:** `server/routes/auth.ts` — credentials live in the `ADMIN_CREDENTIALS` env var
(server-only). Login returns a signed JWT stored in an `httpOnly` cookie. The client stores
only non-sensitive session fields.

---

### H6 · WebSocket hub decoupled from singletons
**Problem:** `wsHub.ts` was 642 lines with module-level null function pointers as the only
bridge between HTTP routes and the WebSocket hub. Impossible to unit-test without starting a
real HTTP server. Calling `attachWsHub()` twice silently dropped the previous implementation.

**Fix:** `HubStore` class injected into both `registerApiRoutes` and `attachWsHub`. Hub split
into focused sub-modules: `presence.ts`, `chat.ts`, `trajectory.ts`.

---

### M1 · Env var validation centralised
**Problem:** Missing env vars failed silently at runtime. The same credential was addressable
via multiple names (`APPLE_TEAM_ID` / `VITE_MAPKIT_TEAM_ID`). `PDR_API_ORIGIN` must not end
in `/api` — a bug so common it needed an ad-hoc runtime normaliser in `server.ts`.

**Fix:** `server/config.ts` — reads, validates, and exports all env vars. Crashes at startup
with a clear message if a required var is missing. Deprecated aliases log a warning and are
normalised centrally.

---

### M2 · Hardcoded passenger IDs removed from render logic
**Problem:** Specific passenger IDs were special-cased directly inside `useMemo` and sort
comparators:
```ts
if (p.id === "P8" && !isOnline) { ... }   // lost override
if (p.id === "P11" && isOnline) { ... }   // lounge pin override
if (a.id === "P8" && b.id !== "P8") return -1;  // sort order
```
Changing a demo scenario required hunting through 6+ files.

**Fix:** `presenceBehavior` and `sortPriority` fields on each scenario object in the airport
config. `useDashboard.ts` reads these fields generically — no ID checks anywhere.

---

### M3 · React Router replaces pathname checks in render
**Problem:** `App.tsx` checked `window.location.pathname` and called side-effect functions
before hooks — a Rules of Hooks violation (hooks after a conditional early return).

**Fix:** React Router `<Routes>` in `App.tsx`. The `/pax` route renders `<PaxEntryWrapper>`
directly; all other paths go through the auth guard.

---

### M4 · Filesystem paths centralised
**Problem:** `server.ts` used scattered `path.join(__dirname, "../../...")` chains that
broke silently if the directory layout changed.

**Fix:** `server/paths.ts` — all resolved paths exported from one place.

---

### Additional (this session)
- `statusBadge()` and `extStatusLabel()` were duplicated in `Dashboard.tsx`,
  `DashboardTab.tsx`, and `RiskBadges.tsx` → extracted to `src/utils/statusDisplay.ts`
- World-builder functions (`buildPekWorld`, `buildSFOWorld`, `buildSFOGates`,
  `buildSFOFlights`) were inline in `Dashboard.tsx` → moved to their airport config files
- Demo simulator pax lists (`simPax`) were hardcoded inline in `Dashboard.tsx` →
  exported as `PEK_SIM_PAX` / `SFO_SIM_PAX` from the airport configs
- `buildSFOWorld` used `SFO_PREMIUM_IDS` to override `profile.plan` — redundant, since
  `plan` is already set on each profile → now uses `profile.plan` directly
- Nav-request handler in `hub/wsHub.ts` hardcoded flight-number→gate strings →
  replaced with `SFO_FLIGHT_GATE_MAP` lookup (already in `sfo.ts`)
- `(loungeP as any)` cast in `useDashboard.ts` → typed `typeof p`
- `loginWithSSO` in `App.tsx` hardcoded an empty password (always a 401) → uses
  `demo`/`demo` credentials
- `chatHistory` prop passed to `DashboardTab` but never used → removed
- `src/config/indoorMap.ts` had two unnecessary wrapper functions → replaced with a
  single exported constant `INDOOR_MAP_URL`
- `src/data/routeE15toE19.ts` was dead code (no importers) → deleted
- Leftover temp file `leafletAdapter.ts.tmp.*` → deleted
- Unit tests added: `src/sim/__tests__/computePassenger.test.ts` (19 tests covering
  `computePassenger`, `stepWorld`, `haversineMeters`)

---

## File Structure

```
apps/dashboard/
├── server/                        # Node.js / Express backend
│   ├── server.ts
│   ├── config.ts
│   ├── paths.ts
│   ├── indoorMapProxyUtils.ts
│   ├── hub/
│   │   ├── wsHub.ts
│   │   ├── HubStore.ts
│   │   ├── presence.ts
│   │   ├── chat.ts
│   │   └── trajectory.ts
│   └── routes/
│       ├── auth.ts
│       ├── flight.ts
│       ├── mapkit.ts
│       └── push.ts
│
└── src/                           # React / TypeScript frontend
    ├── main.tsx
    ├── styles.css
    ├── types/
    │   └── types.ts
    ├── utils/
    │   └── statusDisplay.ts
    ├── config/
    │   └── indoorMap.ts
    ├── app/
    │   ├── App.tsx
    │   └── Dashboard.tsx
    ├── components/
    │   ├── GateCard.tsx
    │   ├── LoginScreen.tsx
    │   ├── PassengerCard.tsx
    │   ├── PaxEntryWrapper.tsx
    │   ├── Toast.tsx
    │   └── TopBar.tsx
    ├── features/
    │   ├── chat/
    │   │   └── ConversationPanel.tsx
    │   ├── fids/
    │   │   └── FidsPanel.tsx
    │   ├── map/
    │   │   ├── MapView.tsx
    │   │   ├── leafletAdapter.ts
    │   │   └── mapkitAdapter.ts
    │   └── passengers/
    │       ├── DashboardTab.tsx
    │       ├── RiskBadges.tsx
    │       └── useDashboard.ts
    ├── sim/
    │   ├── engine.ts
    │   ├── airports/
    │   │   ├── pek.ts
    │   │   └── sfo.ts
    │   └── __tests__/
    │       └── computePassenger.test.ts
    └── services/
        ├── auth.ts
        ├── fidsService.ts
        ├── flightService.ts
        ├── gateService.ts
        ├── loungeRoute.ts
        ├── passengerAliases.ts
        ├── passengerSpawn.ts
        ├── pekPoiCoords.ts
        ├── realtime.ts
        └── utils.ts
```

---

## File Reference

### Server

#### `server/server.ts`
Entry point. Creates a shared `HubStore`, mounts all Express routes
(`/api/auth`, `/api/mapkit`, `/api/orienta`, `/api/push`), attaches the WebSocket hub, and
starts the HTTP server. In development, Vite's dev-server plugin calls the same wiring.

#### `server/config.ts`
Reads and validates every env var at startup. Crashes immediately with a clear error if a
required var (`JWT_SECRET`, `ADMIN_CREDENTIALS`) is missing. Handles deprecated aliases
(e.g. `VITE_MAPKIT_TEAM_ID` → `APPLE_TEAM_ID`) with deprecation warnings. Exports
`getAdminCredentials()`, `isMapKitConfigured()`, `isPushConfigured()`.

#### `server/paths.ts`
All resolved filesystem paths in one place: `DIST_DIR`, `PUBLIC_DIR`,
`LOCAL_INDOOR_MAP_API_DIR`, `LOCAL_INDOOR_MAP_TILES_DIR`, `PEK_CSV_PATH`, etc.

#### `server/indoorMapProxyUtils.ts`
Utilities for proxying and rewriting the indoor map HTML served inside an iframe:
header injection, URL rewriting so relative assets resolve correctly, HTTPS/iframe safety
headers.

---

#### `server/hub/wsHub.ts`
Attaches a `WebSocketServer` to the HTTP server. On each connection it parses a `hello`
message to determine role (`admin` or `pax`) and tenant. Routes subsequent messages by
`type` to the appropriate sub-module or handles inline (`send`, `ack`, `chat_send`,
`nav_request`, `pax_trajectory`, `chat_fetch`, `loc_request`, `chat_read`).

#### `server/hub/HubStore.ts`
Shared in-memory state for the hub. Holds: admin socket sets per tenant, pax socket sets
per `tenantId::passengerId` key, the online-presence set, pending push messages, per-pax
chat history (capped at 100 messages), live trajectory data, and pax display metadata.
Exposes `broadcastAdmins()`, `broadcastPax()`, `appendChat()`, `updateMessageStatus()`.

#### `server/hub/presence.ts`
Pax online/offline state machine. `setPresence()` updates the store and broadcasts a
presence event to all admin sockets. `schedulePaxOffline()` sets a 12-second grace-period
timer before marking a pax offline (prevents false flaps on short disconnects).
`cancelPaxOffline()` cancels the timer when the pax reconnects.

#### `server/hub/chat.ts`
Handles pax-outbound chat messages. Stores the message, broadcasts to admins, and
generates an AI-agent auto-reply based on keywords in the message and the passenger's
current status.

#### `server/hub/trajectory.ts`
Stores live PDR (pedestrian dead reckoning) path and position data sent by a pax device,
then broadcasts it to all admin sockets for that tenant.

---

#### `server/routes/auth.ts`
- `POST /api/auth/login` — validates credentials against `ADMIN_CREDENTIALS`, signs a
  JWT, sets an `httpOnly` `SameSite=Lax` cookie.
- `GET /api/auth/me` — validates the cookie and returns session info.
- `POST /api/auth/logout` — clears the cookie.

#### `server/routes/flight.ts`
Flight data and airport API routes: `/api/flights`, `/api/orienta/indoor-map-*` proxy,
`/api/orienta/admin-presence` poll, `/api/orienta/pdr-proxy`, PEK merged-video endpoint.

#### `server/routes/mapkit.ts`
`GET /api/mapkit/token` — signs and returns a short-lived Apple MapKit JWT using the
configured private key (`APPLE_PRIVATE_KEY` or `APPLE_PRIVATE_KEY_PATH`).

#### `server/routes/push.ts`
`POST /api/push/subscribe` — saves a Web Push subscription.
`POST /api/push/send` — sends a VAPID push notification to a subscriber.

---

### Frontend — entry & types

#### `src/main.tsx`
React entry point. Mounts `<App />` into `#root`.

#### `src/styles.css`
Global CSS: layout primitives, component classes, dark theme tokens.

#### `src/types/types.ts`
Single source of truth for all shared types used by both client and server:
`LatLng`, `Gate`, `Flight`, `Passenger`, `PassengerComputed`, `PassengerActivity`,
`TransferInfo`, `PaxExtStatus`, `PaxPlan`, `PaxPresenceBehavior`, `ChatMessage`,
`MsgRecord`, `PresenceEvent`, `PaxTrajectoryData`, `AdminSession`, and more.

#### `src/utils/statusDisplay.ts`
`STATUS_COLORS` map (PaxExtStatus → hex color), `statusBadge()`, `extStatusLabel()`.
Shared by `Dashboard`, `DashboardTab`, and `RiskBadges` — previously duplicated in all
three.

#### `src/config/indoorMap.ts`
Single exported constant `INDOOR_MAP_URL` read from `VITE_INDOOR_MAP_URL`. Consumed by
`MapView` and `TopBar` to decide whether the indoor map iframe is enabled.

---

### Frontend — app

#### `src/app/App.tsx`
Route guard only. On mount, validates the session cookie via `GET /api/auth/me`. Uses
React Router `<Routes>` to render `<PaxEntryWrapper>` at `/pax`, `<LoginScreen>` when
unauthenticated, or `<Dashboard>` when authenticated.

#### `src/app/Dashboard.tsx`
Main admin layout component. Owns: airport selection (PEK / SFO), gate and flight loading,
tab switching (Dashboard ↔ Map), resizable sidebar, responsive layout. Calls `useDashboard`
for all state. Delegates rendering to `TopBar`, `DashboardTab`, `MapView`, `PassengerCard`,
`ConversationPanel`, `FidsPanel`.

---

### Frontend — components

#### `src/components/LoginScreen.tsx`
Email/password login form with an SSO button. Calls the auth callbacks provided by `App`.

#### `src/components/TopBar.tsx`
Top navigation bar: search input, map-mode toggle (OSM / Apple), pause button, airport
switcher, tab switcher, WS status indicator, user label, logout.

#### `src/components/PassengerCard.tsx`
Detailed passenger info shown in the sidebar when a passenger is selected on the map.
Displays ETA, status, flight, transfer info, recent messages, and SMS/chat action buttons.

#### `src/components/GateCard.tsx`
Gate summary card showing gate ID, assigned flight, and passenger counts.

#### `src/components/PaxEntryWrapper.tsx`
Entry point for the passenger-facing PWA. Parses URL parameters (spawn point, lounge flag,
tenant, passenger ID) and renders the passenger client interface.

#### `src/components/Toast.tsx`
Toast notification host. Renders up to 5 stacked toasts, auto-dismisses after 4.5 seconds.

---

### Frontend — features

#### `src/features/chat/ConversationPanel.tsx`
Admin ↔ pax two-way chat panel. Renders in `docked` mode (pinned beside the map on wide
screens) or `floating` mode (overlay on narrow screens). Shows message history with
delivery/read receipts, a text input, and a "request location" button.

#### `src/features/fids/FidsPanel.tsx`
Flight Information Display System. `<DeparturesFids>` and `<ArrivalsFids>` show upcoming
and recent flights for the selected airport, styled like a real FIDS board.

#### `src/features/map/MapView.tsx`
Map container. If `INDOOR_MAP_URL` is set, renders the indoor map iframe. Otherwise
switches between Leaflet (OSM) and Apple MapKit based on `mapMode`. Renders passenger
markers and path polylines, handles click/hover selection.

#### `src/features/map/leafletAdapter.ts`
OpenStreetMap/Leaflet map implementation. Manages the Leaflet map instance, passenger
markers (coloured by status), path polylines, tile layers, and fit-bounds logic.

#### `src/features/map/mapkitAdapter.ts`
Apple MapKit implementation. Fetches a signed token from `/api/mapkit/token`, initialises
MapKit JS, renders native annotations for passengers and gates.

#### `src/features/passengers/DashboardTab.tsx`
Passenger table view. Filter bar (All / Lost / Urgent / Missed / Offline / Premium),
status-sorted rows, per-row action buttons (Chat, Request Location, SMS). Above the table,
a "Requires Immediate Action" section highlights the priority list.

#### `src/features/passengers/RiskBadges.tsx`
Pure display component. Six coloured count badges: On Track / Tight / At Risk / Lost /
Offline / Missed.

#### `src/features/passengers/useDashboard.ts`
The main state hook for the dashboard. Owns:
- Sim tick loop (`setInterval` calling `stepWorld` every second)
- `passengersRaw` world state, reset when airport changes
- WebSocket realtime connection (`connectAdminRealtime`) with presence, chat, trajectory
  event handlers
- HTTP presence poll (backup for flaky tunnels)
- Computed passenger list: applies `presenceBehavior` overlays, calls `computePassenger`
  for each passenger, overlays live PDR trajectory data
- Priority list and risk counts
- Selection, search, and map-view-mode state
- Action callbacks: `sendSms`, `sendChat`, `requestLocation`, `openConversation`
- Toast queue

---

### Frontend — simulation

#### `src/sim/engine.ts`
Generic, pure simulation engine. No React, no side effects.
- `stepWorld(world, gatesById, dtMs, config)` — advances all moving passengers by `dtMs`
  milliseconds. Wheelchair passengers move at `walkSpeedWheelchairMps`. Transitions a
  passenger to `at_gate` when within `gateArrivalThresholdM` of their gate.
- `computePassenger(p, flight, gate)` — computes display status (green / yellow / red /
  gray), ETA in minutes, and a human-readable reason string. Pure function; the
  highest-value unit-test target.
- `computeGateStats(passengers, gateId)` — counts boarded / at-gate / en-route /
  not-moving for a gate.
- `defaultSmsTemplate`, `agentReply` — text generation helpers for push messages and
  AI agent responses.
- Math helpers: `haversineMeters`, `clamp`, `randPick`, `randomNearby`, `clampToBbox`,
  `makePolyline`, `offsetMs`.

#### `src/sim/airports/pek.ts`
PEK T3E single source of truth:
- `PEK_CENTER`, `PEK_BBOX` — geography
- `PEK_GATE_COORDS_STATIC` — 36 E-gate coordinates (static fallback; live coords come
  from the indoor-map API)
- `PEK_INBOUND_FLIGHTS`, `PEK_OUTBOUND_FLIGHTS` — 9 inbound, 11 outbound Air China
  international flights
- `PEK_PROFILES` — 30 passenger profiles (name, nationality, locale, plan, wheelchair)
- `PEK_SCENARIOS` — per-passenger demo scenario (extStatus, activity, flight indices,
  `presenceBehavior`, `sortPriority`)
- `PEK_PREMIUM_IDS` — set of premium passenger IDs
- `PEK_CONFIG` — `AirportConfig` for the sim engine (1.20 m/s, 20 m gate threshold)
- `pekGateCoord(gates, name)` — resolves a gate coordinate from live API data, falling
  back to static coords, then airport centre
- `buildPekWorld(gates)` — builds the initial `WorldState` for PEK
- `PEK_SIM_PAX` — demo passenger list for the sidebar Pax Simulator panel

#### `src/sim/airports/sfo.ts`
SFO equivalent of `pek.ts`:
- `SFO_CENTER`, `SFO_BBOX` — geography
- `SFO_GATE_COORDS` — 100+ gate coordinates from OSM (all terminals: A–G)
- `SFO_AMENITIES` — walking area anchor points for idle passengers
- `SFO_INBOUND_FLIGHTS`, `SFO_OUTBOUND_FLIGHTS` — 8 inbound, 10 outbound flights
- `SFO_FLIGHT_GATE_MAP` — flight-number → gate lookup used by the WS hub nav-request
  handler
- `SFO_PROFILES`, `SFO_SCENARIOS` — 24 profiles, per-passenger scenarios
- `SFO_PREMIUM_IDS`, `SFO_CONFIG` — premium set, AirportConfig (1.15 m/s, 15 m
  threshold)
- `buildSFOWorld()`, `buildSFOGates()`, `buildSFOFlights()` — world/gate/flight builders
- `SFO_SIM_PAX` — demo passenger list for the sidebar Pax Simulator panel

#### `src/sim/__tests__/computePassenger.test.ts`
Vitest unit tests (19 tests) covering `computePassenger` (terminal states, ETA, activity
reasons, wheelchair, shopping/dining), `stepWorld` (movement, gate arrival transition,
wheelchair speed, frozen states), and `haversineMeters` (symmetry, zero distance).

---

### Frontend — services

#### `src/services/auth.ts`
Client-side session management. `getSession()` reads the cached session from
`sessionStorage`. `fetchSession()` calls `GET /api/auth/me` to validate on page load.
`logout()` calls `POST /api/auth/logout` and clears the cache.

#### `src/services/realtime.ts`
`connectAdminRealtime(opts)` — WebSocket client for the admin dashboard. Handles
auto-reconnect with exponential backoff. Dispatches typed events (presence, msg, msg_status,
chat_msg, chat_history, chat_read, pax_trajectory) to callbacks provided by `useDashboard`.
Exposes `send()`, `chatSend()`, `requestLocation()`, `fetchHistory()`.

#### `src/services/gateService.ts`
`loadGates()` — fetches PEK T3E gate data from `/api/orienta/indoor-map-api/poi`. Parses
the GeoJSON/JSON response into `Gate[]`. Falls back gracefully if the API is unavailable.

#### `src/services/flightService.ts`
`buildPekFlights()` — builds a `Flight[]` from `PEK_OUTBOUND_FLIGHTS`, stamping each with
a live `scheduledDep` relative to `Date.now()`. SFO flights are built directly in `sfo.ts`.

#### `src/services/pekPoiCoords.ts`
Loads live POI data (gates, amenities) from the indoor-map API and caches it in memory.
Exposes typed accessors: `getPekGateCoord()`, `getPekGateCoords()`,
`getPekIndoorAmenities()`, `getT3EBbox()`, `getT3ESpineCenter()`,
`preloadPekPoiFromMapApi()`.

#### `src/services/passengerAliases.ts`
`resolveCanonicalPassengerId(raw)` — maps human-friendly alias strings (e.g. `"sifu"`,
`"yan"`, `"sophie"`) to canonical passenger IDs (`"TX1"`, `"TX3"`, `"TX2"`). Used by the
WS hub so demo devices can connect without knowing internal IDs.

#### `src/services/passengerSpawn.ts`
`parseSpawnFromQuery(getter)` — parses `?lounge=1` / `?spawnLat=&spawnLng=` from the pax
URL to determine where on the map the passenger should spawn. `MOCK_LOUNGE_SPAWN` is the
fixed lounge demo pin for PEK.

#### `src/services/loungeRoute.ts`
`normalizeLoungePathToPax()` — rewrites `/lounge/...` paths to `/pax?lounge=1&...` so
lounge QR codes resolve correctly regardless of how the URL was scanned.

#### `src/services/fidsService.ts`
Fetches or constructs FIDS data (departures and arrivals) for a given airport. Used by
`FidsPanel`.

#### `src/services/utils.ts`
Low-level math helpers: `clamp`, `haversineMeters`, `makePolyline`, `randPick`. (Also
re-exported from `sim/engine.ts` for sim consumers.)
