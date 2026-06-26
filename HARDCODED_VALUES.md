# Orienta v3 — Hardcoded Values Audit

> Created: 2026-06-07  
> Scope: `apps/dashboard` (server, `src/`, `public/`)  
> Purpose: catalogue hardcoded config, demo data, and magic strings so follow-up refactors can be done incrementally.

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
| `src/app/Dashboard.tsx` ~24–25 | `tenantId = "airchina"`, `airport = "PEK"` | todo |
| `server/passengers/PaxAccountStore.ts` ~35, ~72 | SQL default + upsert fallback `"airchina"` | todo |
| `public/route_site/index.html` ~2747 | `ROUTE_SITE_TENANT_ID = "airchina"` | todo |
| `public/pax.html`, `pax-flight.html`, `pax-route-video.html` | `?tenant=` fallback `airchina` | todo |

**Note:** `ROUTE_SITE_DEFAULT_TENANT` exists in `server/config.ts` but React admin UI does not read it.

**Suggested fix:** add `VITE_ORIENTA_TENANT` / `VITE_DEFAULT_AIRPORT`; wire Dashboard + PaxAccountStore to the same source.

---

### 2. Airport / hub branching (PEK vs SFO)

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `server/routes/flight.ts` ~30–47 | `PEK`/`ZBAA` vs `SFO`/`KSFO` branches for center & gates | todo |
| `src/features/map/MapView.tsx` ~223 | PEK → tenant `airchina`, else → `airchina_sfo` | todo |
| `src/features/passengers/useDashboard.ts` | `airport: "PEK" \| "SFO"` split logic | todo |
| `public/route_site/index.html` ~949 | default hub `SFO` (inconsistent with Dashboard default PEK) | todo |
| `public/pax.html` ~181 | `tenantId === "airchina" ? "PEK" : "SFO"` | todo |

**Suggested fix:** single `AirportId` + `tenantForAirport()` in `src/config/` (or shared package).

---

### 3. Terminal `T3E` locked everywhere

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `src/services/pekPoiCoords.ts` ~110 | `/api/poi?terminal=T3E` | todo |
| `server/lib/poiCache.ts` ~73 | same POI query | todo |
| `src/app/Dashboard.tsx` ~110, ~130 | UI labels `PEK T3E`, `T3E/I→I` | todo |
| `src/features/passengers/DashboardTab.tsx` ~40 | dashboard title mentions T3E | todo |

**Suggested fix:** `DEFAULT_TERMINAL=T3E` in config; one helper `poiUrl(terminal)`.

---

### 4. Static airport / demo data files

Primary sources:

| File | Contents |
|------|----------|
| `src/data/airports/pek.ts` | PEK flights (CA836…), premium IDs (TX1…), transfer gates (E16→E19), demo flight indices |
| `src/data/airports/sfo.ts` | SFO flights, gate coord table, `SFO_FLIGHT_GATE_MAP`, premium IDs |

**Consumers (non-exhaustive):**

| Consumer | Usage |
|----------|-------|
| `server/routes/paxSessions.ts` | `buildPekFlights()` for session gate resolution |
| `server/hub/wsHub.ts` | `SFO_FLIGHT_GATE_MAP` for WS gate inference |
| `server/auth/paxAuthPolicy.ts` | `PEK_PREMIUM_IDS` / `SFO_PREMIUM_IDS` for legacy chat entitlement |
| `src/features/passengers/useDashboard.ts` | `buildSFOPassengers()` |
| `src/components/PaxEntryWrapper.tsx` | `PEK_PAX_DEMO_CONFIG`, `PEK_DEFAULT_TRANSFER_GATES` |
| FIDS / flight services | static fallback when FlightAware unavailable |

**Suggested fix:** mark files as `*.demo.ts`; production paths use live FIDS + session `capabilities` only.

---

### 5. Default gate `E19`

| Location | Hardcoded value | Status |
|----------|-----------------|--------|
| `server/routes/paxSessions.ts` ~51 | `resolveOutbound()` fallback gate `"E19"` | todo |
| `public/route_site/index.html` ~1676 | PEK path fallback `toG = 'E19'` | todo |

**Suggested fix:** `DEFAULT_GATE` per airport in config, or no fallback (return 400 if flight unknown).

---

### 6. API base path — React vs static pages

| Pattern | Location | Issue |
|---------|----------|-------|
| Root-relative `fetch("/api/...")` | `src/app/App.tsx`, `src/services/auth.ts`, `src/features/pax/session.ts`, `src/services/pdrClient.ts` | Breaks sub-path deploy (e.g. `/orienta`) |
| `orientaUrl()` base path helper | `public/orienta-base.js` | Static pages support `/orienta` prefix; React does not |

**Suggested fix:** `src/config/api.ts` with `apiUrl(path)` mirroring `orienta-base.js`; use in all `fetch` / WS URLs.

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

| Value | Location |
|-------|----------|
| PEK center `40.0748162, 116.6061088` | `src/services/pekPoiCoords.ts`, `server/lib/poiCache.ts`, `src/features/map/leafletAdapter.ts` |
| PEK bbox `40.0694–40.0800, 116.6008–116.6108` | same files |
| SFO center & bbox | `src/data/airports/sfo.ts` |
| ~80 SFO gate lat/lng pairs | `src/data/airports/sfo.ts` |
| New passenger spawn radius `400` m | `server/passengers/PassengerRegistry.ts` |

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
| Login form pre-filled `admin@airchina.com` / `orienta123` | `src/components/LoginScreen.tsx` | todo |
| Login hint text with demo creds | `src/components/LoginScreen.tsx` | todo |
| Startup log URL `pid=TX1` | `server/server.ts` | todo |
| BCBP alias `DA8X3→TX1`, etc. | `public/route_site/index.html`, demo flows | todo |
| Client `POST /api/metrics/events` | `public/orienta-metrics.js` — **no server route** | todo |
| PDR error hints mentioning port 10000 | `public/orienta-pdr-client.js`, `PaxAppPage.tsx` | todo |

---

## Largest hardcoded block: `public/route_site/index.html`

~6500 lines. Embedded demo assets and logic include:

- Video basenames (`PEK_T3E_F3_E32_...`, `PEK_gate_timestamp_merged.mp4`)
- CSV name `PEK_gate_timestamp_full_with_E24_E36.csv`
- Path polylines `PATH_LONLAT_PEK`, `PATH_LONLAT_SFO`
- Gate graph / segment timing (`GATE_CHECKPOINTS`, `ROUTE_GATE_SEGMENTS`, stretch defaults)
- Tenant, passenger aliases, default hub
- Tencent Maps doc link, PDR embed params
- Indoor map embed timeout defaults

**Duplicates** data also in `src/data/airports/pek.ts` (e.g. TX1/TX2/TX3 transfer E16/E17/E18 → E19).

**Long-term direction:** extract `route-site-config.json` (or per-hub JSON) + thin bootstrap script; keep HTML as shell only.

---

## Known inconsistencies to fix when touching route_site

| Issue | Detail |
|-------|--------|
| CSV filename | `server/paths.ts` uses `PEK_gate_timestamp_full_with_E24_E36.csv`; repo also has `PEK_gate_timestamp.csv` (shorter, 19 rows) |
| Default hub | Admin Dashboard defaults to PEK; `route_site` query default is SFO |
| Premium entitlement | Session JWT has `capabilities`, but `paxAuthPolicy.ts` still checks static `PEK_PREMIUM_IDS` for legacy paths |

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
│       └── sfo.demo.ts
└── public/route_site/
    ├── config.pek.json        # future: gates, video names, aliases
    └── index.html             # thin loader only (long-term)
```

---

## Recommended refactor order

Use this as a checklist. Mark done in the **Status** column above.

### Phase A — quick wins (1–2 days)

- [ ] **A1** Add `VITE_ORIENTA_TENANT` + `VITE_DEFAULT_AIRPORT`; use in `Dashboard.tsx`
- [ ] **A2** `PaxAccountStore` default tenant → `ROUTE_SITE_DEFAULT_TENANT` from config
- [ ] **A3** Extract `DEFAULT_TERMINAL` (`T3E`); single POI URL builder
- [ ] **A4** `src/config/api.ts` — `apiUrl()` / `wsUrl()` for sub-path deploy
- [ ] **A5** `LoginScreen` pre-filled creds only when `import.meta.env.DEV`

### Phase B — demo vs production boundary (2–4 days)

- [ ] **B1** Rename / document `src/data/airports/*.ts` as demo seed data
- [ ] **B2** Remove `PEK_PREMIUM_IDS` from chat policy when `PAX_LEGACY_AUTH=0`
- [ ] **B3** `resolveOutbound()` — configurable default gate or strict error
- [ ] **B4** Align `route_site` default hub with admin default (or explicit `?hub=` only)
- [ ] **B5** Resolve CSV naming: one canonical file + symlink or copy in docs

### Phase C — route_site decomposition (larger)

- [ ] **C1** Extract PEK/SFO config JSON from `index.html`
- [ ] **C2** Deduplicate TX1/TX2/TX3 gates — single source shared with `pek.demo.ts`
- [ ] **C3** Implement or remove `/api/metrics/events`

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
| Demo flights / passengers | `src/data/airports/pek.ts`, `src/data/airports/sfo.ts` |
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
