# Orienta v3 — Production & Multi-Airport Roadmap

> Created: 2026-06-07  
> Updated: 2026-06-07 — **PEK-only scope** (SFO airport demo removed)  
> Scope: `orienta_v3` standalone repo (`apps/dashboard` + `pdr_airchina`)  
> Companion docs: [`HARDCODED_VALUES.md`](./HARDCODED_VALUES.md), [`PASSENGER_PRODUCTION_WORKLOG.md`](./PASSENGER_PRODUCTION_WORKLOG.md), [`README.md`](./README.md)

---

## Product scope (2026-06)

**Supported hub:** PEK T3E only (`tenantId` default `airchina`).

**Removed:** SFO airport demo (`sfo.ts`, SFO CSV/video assets, dual-hub UI). Demo flight **CA7206 from San Francisco → PEK** remains as PEK transfer story data.

**Future airports:** add via config-driven `AirportRegistry` (see Part 2) — do not restore deleted SFO module.

---

## How to use this doc

- **Status** column: `todo` | `in-progress` | `done` | `wontfix`
- Checkboxes track sprint progress; update as you ship.
- Production and multi-airport work overlap — see [Unified timeline](#unified-timeline) for recommended order.

---

## Executive summary

**What we have:** Docker/Compose, passenger session JWTs, SQLite persistence (passengers, accounts, chat, audit), admin httpOnly cookies, rate limits, maintenance jobs, and production env flags (`PAX_LEGACY_AUTH`, `ORIENTA_ALLOW_DEMO`).

**What we lack for real production:** hardened auth boundaries, health/backup runbooks, live FIDS, CI/tests, observability, and a clear legacy-page strategy.

**Multi-airport gap:** Runtime is **multi-tenant** (`tenantId`) but not **multi-airport** (`airportId`). The codebase is now **PEK-only** (SFO demo removed). Adding a new hub requires the **Airport/Tenant Registry** (Part 2) — not copy-paste of old SFO branches.

**Recommended strategy:** Ship production P0 security/deploy items in parallel with **Airport/Tenant Registry** (Phase 0–1). Registry unlocks faster airport onboarding when needed.

---

## Current state snapshot

### Foundations already in place

| Area | Status | Key paths |
|------|--------|-----------|
| Env validation | ✅ | `apps/dashboard/server/config.ts` |
| Docker deploy | ✅ | `docker-compose.yml`, `apps/dashboard/Dockerfile`, `deploy.example.env` |
| Passenger sessions | ✅ | `server/routes/paxSessions.ts`, `server/passengers/paxSessionToken.ts` |
| Pax accounts (SQLite + scrypt) | ✅ partial | `server/passengers/PaxAccountStore.ts`, `server/lib/passwordHash.ts` |
| Admin cookie auth | ✅ | `server/routes/auth.ts`, `server/auth/adminAuth.ts` |
| WS auth | ✅ when flags set | `server/hub/wsHub.ts`, `server/passengers/paxWsIdentity.ts` |
| Chat persistence | ✅ | `server/hub/ChatRepository.ts`, `server/hub/HubStore.ts` |
| Rate limiting | ✅ in-memory | `server/middleware/rateLimit.ts`, `server/server.ts` |
| Audit log | ✅ partial | `server/lib/auditLog.ts` (admin login only) |
| Retention jobs | ✅ | `server/jobs/maintenance.ts` |
| PDR stack | ✅ | `pdr_airchina/`, `/pdr-api` proxy |

### Critical gaps (one line each)

| Gap | Impact |
|-----|--------|
| Legacy auth default **on** in dev `.env.example` | Easy to deploy with `PAX_LEGACY_AUTH=1` |
| Admin passwords **plaintext in env** | Not enterprise-ready |
| No **`GET /health`** | Docker/orchestrator can't probe app readiness |
| No **SQLite backup** runbook | Data loss on volume failure |
| **Hub state in memory** (presence, push subs, trajectories) | Lost on restart |
| **Static PEK flights** in session resolution | Wrong gates without live FIDS |
| **2 unit test files**, no CI | Regressions slip through |
| **`/api/metrics/events`** client with no server route | Dead telemetry |
| **React `fetch("/api/...")`** ignores sub-path deploy | Breaks under `/orienta` prefix |
| **Dashboard hardcoded** `PEK` + `airchina` | Blocks multi-airport ops console |
| **`route_site/index.html`** ~6500 lines PEK logic | Largest coupling surface |

---

## Part 1 — Production readiness

### P0 — Before go-live (1–2 weeks)

#### Security boundary

- [ ] **P0-1** Set production env (copy from `deploy.example.env`):

```dotenv
JWT_SECRET=<strong-random>
PAX_LEGACY_AUTH=0
ORIENTA_ALLOW_DEMO=0
ADMIN_CREDENTIALS=<real-accounts>
```

- [ ] **P0-2** Align dev templates: root `.env.example` and `apps/dashboard/.env.example` should warn or match production defaults.
- [ ] **P0-3** Gate demo UX to dev only:
  - `src/components/LoginScreen.tsx` — pre-filled creds + hint text
  - `src/app/App.tsx` — demo SSO button
- [ ] **P0-4** Chat entitlement via session `capabilities` only; deprecate `PEK_PREMIUM_IDS` when `PAX_LEGACY_AUTH=0` (`server/auth/paxAuthPolicy.ts`).
- [ ] **P0-5** Protect expensive ops routes — e.g. `POST /api/orienta/pek-merged-video` (`server/routes/flight.ts`) with `requireAdmin`.
- [ ] **P0-6** RBAC: `requireAdmin` should enforce `role` (`admin` / `ops` / `viewer`), not just authenticated (`server/routes/auth.ts`, `server/routes/passengers.ts`).
- [ ] **P0-7** Review open CORS on tourist-position routes (`server/routes/push.ts`).

| Item | Files | Status |
|------|-------|--------|
| P0-1 env | `deploy.example.env` | todo |
| P0-2 templates | `.env.example`, `apps/dashboard/.env.example` | todo |
| P0-3 demo UX | `LoginScreen.tsx`, `App.tsx` | todo |
| P0-4 capabilities | `paxAuthPolicy.ts`, `hub/chat.ts` | todo |
| P0-5 merged-video auth | `server/routes/flight.ts` | todo |
| P0-6 RBAC | `server/routes/auth.ts`, `passengers.ts` | todo |
| P0-7 CORS | `server/routes/push.ts` | todo |

#### Deploy & health

- [ ] **P0-8** Add `GET /health` — process alive + SQLite ping + optional PDR / indoor-map checks (`server/server.ts`).
- [ ] **P0-9** Update Docker `HEALTHCHECK` to hit `/health` (`apps/dashboard/Dockerfile`).
- [ ] **P0-10** Document indoor map topology: bundle tiles (`INDOOR_MAP_*` unset) vs external upstream (`7801` / `3001`).
- [ ] **P0-11** Compose: consider `depends_on: condition: service_healthy` for PDR (`docker-compose.yml`).

| Item | Files | Status |
|------|-------|--------|
| P0-8 health endpoint | `server/server.ts` | todo |
| P0-9 Docker health | `apps/dashboard/Dockerfile` | todo |
| P0-10 map topology | `README.md`, `deploy.example.env` | todo |
| P0-11 compose deps | `docker-compose.yml` | todo |

#### Data & accounts

- [ ] **P0-12** SQLite backup runbook: scheduled `sqlite3 .backup` or volume snapshots; document restore (`README.md` or `docs/ops/`).
- [ ] **P0-13** Passenger accounts: move beyond `PAX_ACCOUNT_CREDENTIALS` env seed — registration, reset, lockout, or IdP (`PaxAccountStore.ts`).
- [ ] **P0-14** Admin accounts: hash passwords or integrate SSO (today: plaintext env compare in `getAdminCredentials()`).

| Item | Files | Status |
|------|-------|--------|
| P0-12 backup | ops docs, cron | todo |
| P0-13 pax accounts | `PaxAccountStore.ts` | todo |
| P0-14 admin auth | `server/config.ts`, `auth.ts` | todo |

---

### P1 — First 30 days after launch

| Item | Description | Key files | Status |
|------|-------------|-----------|--------|
| **P1-1** CI pipeline | GitHub Actions: `npm run build`, `build:server`, `test` | `.github/workflows/` | todo |
| **P1-2** Test coverage | Session API, WS auth, rate limit, BCBP parser, `paxIdentity` | `server/**/*.test.ts` | todo |
| **P1-3** Structured logging | Request ID, levels; replace ad-hoc `console.log` | `server/server.ts` | todo |
| **P1-4** Expanded audit | Passenger CRUD, chat send, session create | `auditLog.ts`, routes | todo |
| **P1-5** Metrics | Implement or remove `/api/metrics/events` | `orienta-metrics.js`, `server.ts` | todo |
| **P1-6** Graceful shutdown | SIGTERM drains HTTP + WS | `server/server.ts` | todo |
| **P1-7** Live FIDS | FlightAware or airport feed; static data = fallback only | `flight.ts`, `fidsService.ts` | todo |
| **P1-8** Legacy page policy | Decide: prod uses `/pax` + `/pax/app` only? Update push URLs | `push.ts`, `public/pax.html` | todo |
| **P1-9** Sub-path deploy | `apiUrl()` / `wsUrl()` for React (mirror `orienta-base.js`) | `src/config/api.ts` | todo |
| **P1-10** Security headers | helmet, trust proxy behind reverse proxy | `server/server.ts` | todo |

---

### P2 — Medium term

| Item | Description | Status |
|------|-------------|--------|
| **P2-1** PostgreSQL option | Replace SQLite for multi-instance / HA | todo |
| **P2-2** Push subscription persistence | Survive restarts | todo |
| **P2-3** Shared rate limit / presence | Redis or sticky sessions for horizontal scale | todo |
| **P2-4** Video merge as job service | Python concat outside Node container | todo |
| **P2-5** Error tracking | Sentry or equivalent | todo |

---

## Part 2 — Multi-airport extensibility (future)

> **Note:** SFO demo was removed (2026-06). This section describes how to add airports **when needed**, starting from a PEK-only codebase.

### Problem statement

There is **no canonical tenant ↔ airport map** in code yet. Today everything assumes **PEK / `airchina`**:

```
tenantId "airchina"  →  airport PEK (Dashboard, pax pages, route_site)
ROUTE_SITE_DEFAULT_TENANT env → "airchina" (server)
route_site forces __ROUTESITE_HUB__ = 'PEK' (non-PEK query params ignored)
```

Session JWT carries `tenantId` but **not** `airportId`.

### Target architecture: config-driven registry

```
apps/dashboard/src/config/
  airports/
    types.ts              # AirportDefinition, AirportId, PoiMode
    registry.ts           # getByIata("PEK"), register(...)
    pek.config.ts         # PEK definition (only hub today)
  tenants/
    registry.ts           # "airchina" → { airportId: "PEK", features }
  client.ts               # VITE_DEFAULT_AIRPORT, VITE_ORIENTA_TENANT
```

#### `AirportDefinition` (sketch)

```typescript
type AirportDefinition = {
  id: string;                    // "PEK"
  iata: string;
  icao?: string;
  terminals: { id: string; label: string }[];
  defaultTerminal: string;       // e.g. "T3E"

  poi: {
    mode: "indoor_api" | "static" | "none";
    terminalQuery?: string;
    parser: "pek_t3e" | "generic";
    staticGates?: Record<string, LatLng>;
    defaultCenter: LatLng;
    bbox?: Bbox;
  };

  demo?: {
    outboundFlights: ...;
    inboundFlights: ...;
    premiumPassengerIds?: Set<string>;
    defaultTransferGates?: { from: string; to: string };
    flightGateMap?: Record<string, string>;
  };

  routeSite?: {
    hubKey: string;
    configUrl: string;           // /route_site/config/pek.json
  };

  map: {
    indoorMapEnabled: boolean;
    gatePattern?: RegExp;
  };
};
```

#### Unified services (replace scattered if/else)

| Service | Replaces |
|---------|----------|
| `PoiService.loadGates(airportId)` | `pekPoiCoords.ts`, `poiCache.ts`, `gateService.ts`, SFO static coords |
| `FlightCatalogService.resolveOutbound(airportId, flightId)` | `paxSessions.ts` + `buildPekFlights()` |
| `TenantRegistry.resolve(tenantId)` | Dashboard, MapView, pax.html inference |
| `PassengerSource` strategy | PEK registry API vs SFO static demo |

#### API additions

- `GET /api/config/tenant/:tenantId` → `{ tenant, airport, terminals, defaults }`
- Optional: include `airportId` in pax session JWT claims
- Generalize `/api/orienta/pek-merged-video` → `/api/orienta/:airportId/merged-video` (keep PEK alias)

#### `route_site` decoupling (largest coupling)

```
public/route_site/
  index.html              # thin shell (~200 lines)
  bootstrap.js            # ?hub= → load config
  config/pek.json         # route_site constants
```

---

### Multi-airport migration phases

| Phase | Scope | Effort | Risk | Status |
|-------|-------|--------|------|--------|
| **0** | Registry scaffold; PEK entry only; no behavior change | 1–2 d | Low | todo |
| **1** | Env: `VITE_DEFAULT_AIRPORT`, `VITE_ORIENTA_TENANT`; unify `terminal=T3E`; align route_site default hub | 1–2 d | Low | todo |
| **2** | Server: `flight.ts`, `paxSessions.ts`, `PassengerRegistry` spawn, `wsHub` nav → registry | 3–5 d | Med | todo |
| **3** | Dashboard + `useDashboard` strategy; `gateService` → `PoiService`; rename PEK POI adapters | 3–5 d | Med | todo |
| **4** | Split `route_site/index.html` into config JSON + engines | 1–2 wk | High | todo |
| **5** | Onboarding doc + `GET /api/config/tenant/:id`; session JWT `airportId` | 2–3 d | Low | todo |

### Adding airport #3 (target state — e.g. LHR)

1. Add `lhr.config.ts` to `AirportRegistry`.
2. Add tenant `british_airways` → `LHR` in `TenantRegistry`.
3. If indoor map exists: POI adapter + `route_site/config/lhr.json`.
4. Deploy: `VITE_ORIENTA_TENANT=british_airways`, `VITE_DEFAULT_AIRPORT=LHR`.
5. **No** new `if (airport === "LHR")` in `Dashboard.tsx`.

### File change index (multi-airport)

#### New files

| File | Purpose |
|------|---------|
| `src/config/airports/types.ts` | Core types |
| `src/config/airports/registry.ts` | Lookup |
| `src/config/airports/pek.config.ts` | PEK definition |
| `src/config/tenants/registry.ts` | Tenant → airport |
| `src/config/client.ts` | Vite env resolution |
| `src/services/poi/PoiService.ts` | Unified gates |
| `src/services/FlightCatalogService.ts` | Flights + resolveOutbound |
| `server/routes/config.ts` | Tenant config API |
| `public/route_site/config/pek.json` | Route site constants |

#### High-priority modifications

| File | Change |
|------|--------|
| `src/app/Dashboard.tsx` | Remove hardcoded PEK / airchina |
| `src/features/passengers/useDashboard.ts` | Passenger source from registry |
| `src/features/map/MapView.tsx` | Tenant from TenantRegistry |
| `server/routes/flight.ts` | Registry-based airport dispatch |
| `server/routes/paxSessions.ts` | `resolveOutbound(airportId, …)` |
| `server/passengers/PassengerRegistry.ts` | Airport-aware spawn bbox |
| `server/hub/wsHub.ts` | Airport-aware flightGateMap |
| `server/lib/poiCache.ts` | Multi-airport cache |
| `server/auth/paxAuthPolicy.ts` | Capabilities over static premium IDs |
| `src/services/gateService.ts` | Delegate to PoiService |
| `public/pax.html` | Tenant config instead of inline PEK/SFO |
| `public/route_site/index.html` | Phase 4: strip to shell |

See [`HARDCODED_VALUES.md`](./HARDCODED_VALUES.md) for the full hardcoded inventory and Phase A–D checklist.

---

## Unified timeline

Production and registry work should run in parallel:

```
Week 1–2   Production P0 (security, /health, backup, env alignment)
           + Airport Phase 0–1 (Registry scaffold + env wiring)

Week 3–4   Production P1 (CI, tests, audit, FIDS integration)
           + Airport Phase 2 (server unification)

Week 5–6   Airport Phase 3 (Dashboard + passenger sources)
           + Legacy page decision (route_site / pax.html in prod?)

Week 7+    Airport Phase 4 (route_site decomposition)
           + Production P2 as needed (Postgres, multi-instance)
```

```mermaid
flowchart LR
  subgraph W1["Week 1–2"]
    P0[Production P0]
    A01[Airport Phase 0–1]
  end
  subgraph W3["Week 3–4"]
    P1[Production P1]
    A2[Airport Phase 2]
  end
  subgraph W5["Week 5–6"]
    A3[Airport Phase 3]
    LEG[Legacy policy]
  end
  subgraph W7["Week 7+"]
    A4[Airport Phase 4]
    P2[Production P2]
  end
  W1 --> W3 --> W5 --> W7
```

---

## Known inconsistencies (fix early)

| Issue | Detail | Track in |
|-------|--------|----------|
| Session JWT | No `airportId` claim | Phase 5 |
| `route_site` canvas | Legacy pixel paths (`PPL_PATH`) still embedded in `index.html` | Phase 4 |
| CSV naming | `PEK_gate_timestamp_full_with_E24_E36.csv` vs shorter local CSV | ops |
| Metrics endpoint | Client posts; server has no handler | P1-5 |

---

## Application surface map

### Production React paths (target)

| Route | Component | Role |
|-------|-----------|------|
| `/` | `Dashboard` | Operator console |
| `/pax` | `PaxEntryPage` | Session creation |
| `/pax/app` | `PaxAppPage` | Authenticated passenger app |

### Legacy static (review for prod)

| Asset | Notes |
|-------|-------|
| `public/pax.html` | Original shell; legacy auth path |
| `public/pax-flight.html`, `pax-route-video.html`, `pax-login.html` | Demo variants |
| `public/route_site/index.html` | ~6500 lines; PEK video/navigation demo |
| `public/orienta-base.js` | Sub-path helper (React lacks equivalent) |

---

## Related documentation

| Doc | Purpose |
|-----|---------|
| [`HARDCODED_VALUES.md`](./HARDCODED_VALUES.md) | Hardcoded value audit + refactor checklist |
| [`PASSENGER_PRODUCTION_WORKLOG.md`](./PASSENGER_PRODUCTION_WORKLOG.md) | Passenger auth implementation log |
| [`CODEBASE.md`](./CODEBASE.md) | v2→v3 refactor overview |
| [`README.md`](./README.md) | Dev setup and security env |
| [`deploy.example.env`](./deploy.example.env) | Production Docker env template |

---

*Update checkboxes and Status fields as work completes.*
