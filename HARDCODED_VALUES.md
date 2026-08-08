# Orienta v3 — Hardcoded Values Audit

> Created: 2026-06-07  
> Updated: 2026-06-28 — **Multi-airport migration (Phase 0–5) landed**: most 🔴 items resolved via the airport/tenant registry, client/server config, and the route_site decomposition. Statuses below reflect the current code.  
> Scope: `apps/dashboard` (server, `src/`, `public/`)  
> Purpose: catalogue hardcoded config, demo data, and magic strings so follow-up refactors can be done incrementally.
>
> **⚠️ Partially stale as of 2026-08.** Everything below this notice predates a
> full demo-data purge and a second production-readiness fix pass. In
> particular: `src/data/airports/pek.ts`/`pek.demo.ts`, `pek.config.ts`,
> `gateService.ts`, `PAX_LEGACY_AUTH`, `ORIENTA_ALLOW_DEMO`, `PEK_PREMIUM_IDS`,
> and every static `public/pax*.html` page referenced below **no longer
> exist** — airport/tenant config now loads from `config/airports/*.yaml` +
> `config/tenants/*.yaml` at runtime (see `server/config/loadConfig.ts`), and
> the only passenger-facing routes are the React `/pax` and `/pax/app`.
> `pdr_airchina/` was removed — PDR lives in sibling `pedestrian_dead_reckoning`.
> Admin FIDS boards are live via `GET /api/fids/*` + FlightAware when
> `FLIGHTAWARE_API_KEY` is set (client stub removed).
> **Video route navigation was removed (2026-08):** mp4 assets, merge worker,
> `/api/orienta/*merged-video`, and the old `route_site` player are gone;
> `/route_site` is a retirement stub pointing at `/pax/app`. Current
> genuinely-still-hardcoded items (verified 2026-08):
>
> - `server/hub/wsHub.ts`'s pax-hello passenger creation, `server/routes/passengers.ts`'s
>   POST body, and a few other write paths accept `flightId`/`gateId`/`tenantId`
>   without case-normalizing — now fixed via `server/lib/canonicalize.ts`.
> - `server/services/fidsService.ts`'s last-resort gate is now
>   `airport.defaultGate` (config/airports/*.yaml), falling back to a generic
>   `"UNKNOWN"` placeholder — no longer a bare hardcoded `"E19"`.
> - `server/hub/chat.ts`'s free-tier AI auto-reply no longer asserts a
>   PEK-T3E-specific floor/level fact for the "security" keyword match.
>
> Everything else below (the 🔴/🟡/🟢 tables, Phase A–D checklist) reflects the
> 2026-06-28 snapshot and should be read as history, not a current TODO list.

## 2026-06 status snapshot

Resolved since the original audit:

- **Airport/tenant registry** — `src/config/airports/{types,registry,pek.config}.ts`, `src/config/tenants/registry.ts`, `src/config/client.ts`. Adding a hub = one `AirportDefinition` + tenant mapping, no scattered `if (airport === …)`.
- **Tenant/airport in admin UI** — `Dashboard.tsx` uses `CLIENT_DEFAULT_TENANT` / `CLIENT_DEFAULT_AIRPORT` (`VITE_ORIENTA_TENANT` / `VITE_DEFAULT_AIRPORT`).
- **Terminal** — `DEFAULT_TERMINAL` env (server) + `airport.poi.terminalQuery` (client); UI labels read the registry.
- **Demo data** — consumed through the registry (`fidsService`/`wsHub`/`PassengerRegistry`/`flightService` server + client).
- **Default gate** — server `fidsService` uses `airport.demo.defaultTransferGates`; route_site reads `config/pek.json`.
- **API base path** — all React `fetch`/WS go through `apiUrl()` / `wsUrl()` (`src/config/api.ts`).
- **route_site** — decomposed into `route-site.css` + 3 engine scripts + `config/pek.json` + `config-bootstrap.js`; hub honors `?hub=`/`?airport=`.

Also cleaned up (2026-06-29):

- **FIDS board** (`src/services/fidsService.ts`) now derives departures/arrivals from the registry demo flights — no hardcoded PEK board.
- **route_site demo data** (TX1/TX2/TX3 route gates, video segment basenames) moved into `config/pek.json` (+ `config-bootstrap.js` builtin); engine reads them with fallbacks.
- **`pek.ts` → `pek.demo.ts`** (explicit demo seed) + all imports updated.
- **`PEK_PREMIUM_IDS`** consulted only when `PAX_LEGACY_AUTH=1` (both `paxAuthPolicy.ts` and `chat.ts`).

Still hardcoded (intentional demo fixtures / cosmetics): static `pax*.html` pages are **already query-parameterized** (`?tenant=`, `?hub=`/`?airport=`); their remaining literals are demo passenger fixtures (TX1/P8 → gates) and PEK defaults, not multi-airport blockers. Plus cosmetic branding (`/airchina-logo.png`), admin display names, and the `pid=TX1` startup log. See per-item status below.

---

## Scope note (2026-06)

**Supported hub:** PEK T3E only.

**Removed:** `src/data/airports/sfo.ts`, SFO CSV assets, dual-hub branches in TS/server, `path_lonlat.json` (SFO coords), SFO branches in `route_site/index.html`.

**Keep:** Flight/city **SFO** in demo data (e.g. inbound `CA7206 from SFO`) — that is origin city, not SFO airport support.

---

## How to use this doc

- Items are grouped by **impact** (🔴 high / 🟡 medium / 🟢 low).
- **Status** column is for your own tracking: `todo` | `in-progress` | `done` | `wontfix`.
- Prefer fixing 🔴 items before production multi-tenant / multi-airport deployment.
- When you change something, update the status here and note the new env var or file.

---

## Already centralized (keep extending these)

| Module | File | What it owns |
|--------|------|--------------|
| Server env | `apps/dashboard/server/config.ts` | JWT, admin creds, PDR, indoor map upstream, tenant default, DB path, security flags |
| Filesystem paths | `apps/dashboard/server/paths.ts` | `dist/`, `route_site/`, PEK CSV, video concat script |
| Client indoor map | `apps/dashboard/src/config/indoorMap.ts` | `VITE_INDOOR_MAP_URL`, `VITE_INDOOR_MAP_API_BASE` |
| Dev proxy | `apps/dashboard/vite.config.ts` | Port 5173, proxy to backend 5175 |

**Env vars worth knowing** (see also `.env.example`):

```dotenv
JWT_SECRET=...
ADMIN_CREDENTIALS=email:password,...
ROUTE_SITE_DEFAULT_TENANT=airchina
PAX_LEGACY_AUTH=0          # disable legacy pid-only WS in production
ORIENTA_ALLOW_DEMO=0       # disable demo/demo admin login
PDR_API_ORIGIN=http://127.0.0.1:10000
INDOOR_MAP_UPSTREAM=http://127.0.0.1:7801
INDOOR_MAP_API_UPSTREAM=http://127.0.0.1:3001
DB_PATH=./data/passengers.db
```

---

## 🔴 High impact — blocks multi-tenant / multi-airport / sub-path deploy

### 1. Tenant ID `airchina`

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `src/app/Dashboard.tsx` | now `CLIENT_DEFAULT_TENANT` / `CLIENT_DEFAULT_AIRPORT` | done |
| `server/passengers/PaxAccountStore.ts` | upsert fallback → `ROUTE_SITE_DEFAULT_TENANT`; SQL column `DEFAULT 'airchina'` left as inert backstop (upsert always supplies a value) | done |
| `public/route_site/route-site-main.js` | `ROUTE_SITE_TENANT_ID` reads `config/pek.json` `tenantId` (fallback `airchina`) | done |
| `public/pax.html`, `pax-flight.html`, `pax-route-video.html` | `?tenant=` fallback `airchina` | wontfix (legacy static demo pages) |

**Note:** `VITE_ORIENTA_TENANT` / `VITE_DEFAULT_AIRPORT` (`src/config/client.ts`) and `ROUTE_SITE_DEFAULT_TENANT` (`server/config.ts`) are the single sources now.

---

### 2. Airport / hub (PEK-only today)

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `src/app/Dashboard.tsx` | `CLIENT_DEFAULT_AIRPORT` via registry | done |
| `server/passengers/PaxAccountStore.ts` | tenant from `ROUTE_SITE_DEFAULT_TENANT` | done |
| `public/route_site/config-bootstrap.js` | `__ROUTESITE_HUB__` from `?hub=`/`?airport=` (PEK default + only bundled config) | done |
| `public/pax.html` | default hub `PEK` | done |

**Note:** `AirportRegistry` (`src/config/airports/registry.ts`) + `tenants/registry.ts` are the canonical lookup; add a hub via one `AirportDefinition` + `registerTenant(...)`.

---

### 3. Terminal `T3E` locked everywhere

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `src/services/pekPoiCoords.ts` | `terminal` from `clientDefaultAirport().poi.terminalQuery` | done |
| `server/lib/poiCache.ts` | `terminal` from `DEFAULT_TERMINAL` env | done |
| `src/app/Dashboard.tsx` | labels from `clientDefaultAirport().defaultTerminal` | done |
| `src/features/passengers/DashboardTab.tsx` | title from `clientDefaultAirport()` | done |

**Done via:** `DEFAULT_TERMINAL` (`server/config.ts`) + `airport.poi.terminalQuery` (registry). Remaining `T3E` literals are demo asset/CSV names + static pax pages.

---

### 4. Static airport / demo data files

Primary sources:

| File | Contents |
|------|----------|
| `src/data/airports/pek.ts` | PEK flights (CA836…), premium IDs (TX1…), transfer gates (E16→E19), `PEK_FLIGHT_GATE_MAP`, demo flight indices |

**Consumers (now registry-driven unless noted):**

| Consumer | Usage | Status |
|----------|-------|--------|
| `server/services/fidsService.ts` | `airport.demo.outboundFlights` + `defaultTransferGates` | done (registry) |
| `server/hub/wsHub.ts` | `airport.demo.flightGateMap` for WS nav_request | done (registry) |
| `src/services/flightService.ts` | `buildFlights(airportId)` reads `airport.demo.outboundFlights` | done (registry) |
| `server/passengers/PassengerRegistry.ts` | spawn radius from `airport.poi.spawnRadiusM` | done (registry) |
| `server/auth/paxAuthPolicy.ts`, `server/hub/chat.ts` | `PEK_PREMIUM_IDS` legacy entitlement | gated by `PAX_LEGACY_AUTH` (B2) |

**Source of truth:** `pek.config.ts` wraps `src/data/airports/pek.ts` (demo seed). `pek.ts` keeps its name but its header documents it as demo; the `*.demo.ts` rename (B1) is cosmetic and deferred.

---

### 5. Default gate `E19`

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `server/services/fidsService.ts` | `airport.demo.defaultTransferGates.to` (registry), `DEFAULT_GATE="E19"` only as last-resort const | done |
| `public/route_site/route-site-pek-engine.js` | reads `config.defaultRouteGates` (fallback `E16→E19`) | done |

**Note:** per-airport default gate now lives in `airport.demo.defaultTransferGates` / `config/pek.json`.

---

### 6. API base path — React vs static pages

| Pattern | Location | Status |
|---------|----------|--------|
| `apiUrl(path)` / `wsUrl()` helpers | `src/config/api.ts` | done (P1-9) |
| React `fetch` / WS | `App.tsx`, `auth.ts`, `session.ts`, `pdrClient.ts`, `realtime.ts`, pax pages all route through `apiUrl()`/`wsUrl()` | done |

Sub-path deploy (e.g. `/orienta`) works for both React and static pages.

---

## 🟡 Medium impact — has env fallback, defaults are local/dev-oriented

### Service URLs & ports

| Value | Location | Env override |
|-------|----------|--------------|
| `http://127.0.0.1:7801` | `server/config.ts` | `INDOOR_MAP_UPSTREAM` |
| `http://127.0.0.1:3001` | `server/config.ts` | `INDOOR_MAP_API_UPSTREAM` |
| `http://127.0.0.1:10000` | `.env.example` | `PDR_API_ORIGIN` |
| Port `5174` default | `server/config.ts` | `PORT` |
| `localhost:5175` dev proxy | `vite.config.ts`, `package.json` `dev:server` | dev only |
| Port `5173` Vite | `vite.config.ts` | dev only |
| `../../pdr_airchina` | `package.json` `pdr:dev` | monorepo layout assumption |

### Auth, security, ops tuning

| Value | Location | Notes |
|-------|----------|-------|
| `demo` / `demo` admin | `server/config.ts` ~126–127 | when `ALLOW_DEMO_LOGIN` |
| `PAX_LEGACY_AUTH` default on | `server/config.ts` ~97 | set `0` in production |
| Role from email prefix `ops*` | `server/config.ts` ~119 | heuristic, not configurable |
| Display name `国航管理员`, org `Air China` | `server/config.ts` ~120–121 | all admin accounts |
| `mailto:ops@orienta.ai` | `server/config.ts` ~71 | default `VAPID_SUBJECT` |
| Cookie `orienta_admin_token` | `server/auth/adminAuth.ts` | |
| Admin JWT TTL 8h | `server/auth/adminAuth.ts` | |
| Rate limit 20/min auth, 60/min pax | `server/server.ts` | |
| Temp passenger cleanup 48h | `server/jobs/maintenance.ts` | |
| Chat retention 30d | `server/jobs/maintenance.ts` | |
| WS hello timeout 8s | `server/hub/wsHub.ts` | |
| Push away detection 30s | `server/routes/push.ts` | |

### Coordinates & bounding boxes

| Value | Location | Status |
|-------|----------|--------|
| PEK center / bbox | canonical in `pek.config.ts` (`poi.defaultCenter` / `poi.bbox`); `leafletAdapter.ts` fallback reads `clientDefaultAirport().poi.defaultCenter` | mostly centralized; `pekPoiCoords.ts` / `poiCache.ts` keep PEK literals as static fallback |
| New passenger spawn radius `400` m | `airport.poi.spawnRadiusM` (registry); `PassengerRegistry.ts` reads it | done |

### External third-party URLs

| URL | Location |
|-----|----------|
| `https://aeroapi.flightaware.com/aeroapi/flights/...` | `server/routes/flight.ts` |
| `https://{s}.tile.openstreetmap.org/...` | `src/features/map/leafletAdapter.ts` |
| `https://images.kiwi.com/airlines/64x64/...` | `src/features/fids/FidsPanel.tsx` |

### Business rules baked in

| Rule | Location |
|------|----------|
| QR scan session always `plan: "premium"` | `server/routes/paxSessions.ts` |
| `basic-session` → `plan: "free"` | `server/routes/paxSessions.ts` |
| Capabilities list (`navigate`, `operator_chat`, …) | `server/routes/paxSessions.ts` |
| Plans `free` / `premium` | multiple server + client files |
| Admin roles `admin` / `ops` / `viewer` | `server/config.ts`, `src/types/types.ts` |

---

## 🟢 Low impact — demo / dev convenience (disable in production)

| Item | Location | Status |
|------|----------|--------|
| Login form pre-filled creds | `src/components/LoginScreen.tsx` — now gated by `import.meta.env.DEV` | done (A5) |
| Login hint text with demo creds | `src/components/LoginScreen.tsx` — dev-only | done |
| Startup log URL `pid=TX1` | `server/server.ts` | todo (cosmetic) |
| FIDS departures/arrivals board | `src/services/fidsService.ts` → registry demo flights | done |
| BCBP alias `DA8X3→TX1` + TX route gates | `config/pek.json` (`paxAliases`, `paxRouteGates`); static pax pages keep demo fixtures | done (route_site) |
| Client `POST /api/metrics/events` | implemented (P1-5): `server/routes/metrics.ts` → SQLite | done |
| PDR error hints mentioning port 10000 | `public/orienta-pdr-client.js`, `PaxAppPage.tsx` | todo (cosmetic) |

---

## `public/route_site/` — decomposed (Multi-airport Phase 4) ✅

The former ~5.8k-line `index.html` is now:

- `index.html` — 106-line shell
- `route-site.css` — extracted styles
- `config-bootstrap.js` — resolves hub from `?hub=`/`?airport=`, exposes `window.__ROUTESITE_CONFIG__`
- `config/pek.json` — tenant, terminal, default gates, pax aliases, video names, polyline fallback
- `route-site-pek-engine.js` / `route-site-map-geometry.js` / `route-site-main.js` — engines (read config with PEK fallbacks)

**Still embedded (demo content):** video basenames, CSV pacing, gate-segment timing, and the TX1/TX2/TX3 BCBP alias gate map live in `route-site-pek-engine.js`. These are curated PEK demo assets; extract per-hub only when a second hub needs route_site.

---

## Known inconsistencies to fix when touching route_site

| Issue | Detail |
|-------|--------|
| CSV filename | `server/paths.ts` uses `PEK_gate_timestamp_full_with_E24_E36.csv`; repo also has shorter `PEK_gate_timestamp.csv` |
| Premium entitlement | Session JWT has `capabilities`, but `paxAuthPolicy.ts` still checks `PEK_PREMIUM_IDS` for legacy paths |
| route_site canvas | `PPL_PATH` / base64 images are legacy pixel overlay data; refactor in Phase 4 |

---

## Suggested target layout (incremental)

```
apps/dashboard/
├── config/
│   ├── server.ts              # extend existing server/config.ts or re-export
│   ├── client.ts              # VITE_ORIENTA_TENANT, VITE_DEFAULT_AIRPORT, apiUrl()
│   └── constants.ts           # DEFAULT_TERMINAL, DEFAULT_GATE per airport
├── data/
│   └── airports/
│       ├── pek.demo.ts        # rename from pek.ts — explicit demo seed
│       └── (future hubs via registry, not sfo.ts)
└── public/route_site/
    ├── config.pek.json        # future: gates, video names, aliases
    └── index.html             # thin loader only (long-term)
```

---

## Recommended refactor order

Use this as a checklist. Mark done in the **Status** column above.

### Phase A — quick wins

- [x] **A1** `VITE_ORIENTA_TENANT` + `VITE_DEFAULT_AIRPORT`; used in `Dashboard.tsx`
- [x] **A2** `PaxAccountStore` default tenant → `ROUTE_SITE_DEFAULT_TENANT`
- [x] **A3** `DEFAULT_TERMINAL` + registry `terminalQuery`; single POI URL path
- [x] **A4** `src/config/api.ts` — `apiUrl()` / `wsUrl()` for sub-path deploy
- [x] **A5** `LoginScreen` pre-filled creds only when `import.meta.env.DEV`

### Phase B — demo vs production boundary

- [x] **B1** Renamed `src/data/airports/pek.ts` → `pek.demo.ts` + imports updated
- [x] **B2** `PEK_PREMIUM_IDS` consulted only when `PAX_LEGACY_AUTH=1` (`paxAuthPolicy.ts` + `chat.ts`)
- [x] **B3** `resolveOutbound()` — default gate from `airport.demo.defaultTransferGates` (registry)
- [x] **B4** route_site hub honors `?hub=`/`?airport=` (config-driven)
- [ ] **B5** Resolve CSV naming: one canonical file + symlink or copy in docs

### Phase C — route_site decomposition

- [x] **C1** route_site decomposed: `config/pek.json` + `config-bootstrap.js` + 3 engine scripts (Phase 4)
- [x] **C2** route_site TX1/TX2/TX3 gates now sourced from `config/pek.json` (`paxRouteGates`); static pax pages retain their own demo fixtures (intrinsic to the demo)
- [x] **C3** `/api/metrics/events` implemented (P1-5)

### Phase D — production hardening

- [ ] **D1** Document required production `.env` (`PAX_LEGACY_AUTH=0`, `ORIENTA_ALLOW_DEMO=0`)
- [ ] **D2** Move rate limits / retention TTLs to env (optional)
- [ ] **D3** Admin display names from `ADMIN_CREDENTIALS` metadata or DB

---

## File index (quick lookup)

| Category | Primary files |
|----------|---------------|
| Server config | `server/config.ts`, `server/paths.ts` |
| Tenant / airport UI | `src/app/Dashboard.tsx`, `src/features/map/MapView.tsx` |
| Demo flights / passengers | `src/data/airports/pek.ts` |
| Sessions | `server/routes/paxSessions.ts` |
| WS / chat policy | `server/hub/wsHub.ts`, `server/auth/paxAuthPolicy.ts` |
| POI / gates | `src/services/pekPoiCoords.ts`, `server/lib/poiCache.ts` |
| Static pax pages | `public/pax.html`, `public/pax-flight.html` |
| Route video demo | `public/route_site/index.html` |
| Base path helper | `public/orienta-base.js` |
| Client fetch | `src/services/auth.ts`, `src/features/pax/session.ts` |

---

## Related docs

- [`CODEBASE.md`](./CODEBASE.md) — v2→v3 refactor overview
- [`REFACTOR_ANALYSIS.md`](./REFACTOR_ANALYSIS.md) — original v2 structural debt catalogue
- [`PASSENGER_PRODUCTION_WORKLOG.md`](./PASSENGER_PRODUCTION_WORKLOG.md) — passenger auth / production notes
- [`apps/dashboard/.env.example`](./apps/dashboard/.env.example) — env template

---

*Update the **Status** fields and checkboxes as you work through items.*
