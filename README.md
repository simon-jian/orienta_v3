# Orienta v3

Passenger + admin dashboard for airport indoor navigation and operations.

**Hub scope:** PEK T3E only (SFO airport demo removed 2026-06). See [`PRODUCTION_ROADMAP.md`](./PRODUCTION_ROADMAP.md) and [`HARDCODED_VALUES.md`](./HARDCODED_VALUES.md).

## Layout

```text
orienta_v3/
  apps/dashboard/     # React + Express app (main product)
  *.md                # Architecture and production worklogs
```

Related services (in this repo or on your machine):

| Service | Purpose | Default port |
|---------|---------|--------------|
| `apps/dashboard` | Admin UI, passenger `/pax`, WebSocket hub | 5174 / 5175 (dev) |
| `pdr_airchina/` | Python PDR (IMU → trajectory) | 10000 |
| Indoor map (`airport-map.html`) | Tiles + navigation UI | 7801 |
| Indoor map API | POI / zones | 3001 |

## Quick start (development)

```bash
cd apps/dashboard
npm install
cp .env.example .env    # edit JWT_SECRET, credentials, upstream URLs

# Terminal 1 — frontend
npm run dev

# Terminal 2 — backend (proxies /pdr-api when PDR_API_ORIGIN is set)
npm run dev:server

# Terminal 3 — PDR Python backend (optional, for IMU navigation)
npm run pdr:dev
```

- Admin: http://localhost:5173
- Passenger entry: http://localhost:5173/pax
- Passenger app (post-session): http://localhost:5173/pax/app
- Route video / PDR demo (`route_site`, still a supported standalone feature): http://localhost:5173/route_site/?hub=PEK&tenant=airchina

### PDR (pedestrian dead reckoning)

Same model as `orienta_v2_step2`:

1. **Python service** (`pdr_airchina/`) — `POST /api/session`, `WS /ws/pdr/{id}`
2. **Node proxy** — browser calls `/pdr-api/*` → `PDR_API_ORIGIN`
3. **Browser client** — `public/route_site/orienta-pdr-client.js` (video page **PDR** button) or `/pax/app` **Start PDR**

```bash
# Option A: npm (from apps/dashboard)
npm run pdr:dev

# Option B: Docker (from orienta_v3 root)
docker compose up -d orienta-pdr
# then set PDR_API_ORIGIN=http://127.0.0.1:10000 in apps/dashboard/.env
```

Verify: `curl http://localhost:5175/pdr-api/health` (dev) or `curl http://localhost:5174/pdr-api/health` (prod).

PEK anchor: URL `gateFrom=E32&gateTo=E25`, or explicit `pdrOriginLat` / `pdrOriginLng`. Optional: `pdrMapMatch=1`, `pdrOnMap=1`.

## Docker (dashboard + PDR)

```bash
# from orienta_v3 root — copy deploy.example.env and edit JWT_SECRET first
docker compose --env-file deploy.example.env up -d
```

Admin: http://localhost:5174

## Health check

`GET /health` returns process + database status (and reports PDR / indoor-map mode):

```bash
curl http://localhost:5174/health
# {"status":"ok","uptime_s":42,"checks":{"process":"ok","db":"ok","db_dialect":"sqlite","pdr_proxy":"configured","indoor_map":"bundled"},...}
```

Returns `200` when the database (SQLite or Postgres) responds, `503` when degraded.
The Docker `HEALTHCHECK` and Compose `depends_on: condition: service_healthy` both
rely on this endpoint.

## Indoor map topology

Two deployment modes (set in env):

| Mode | `INDOOR_MAP_UPSTREAM` / `INDOOR_MAP_API_UPSTREAM` | Behavior |
|------|--------------------------------------------------|----------|
| **A — Bundled** | empty | Server looks for tiles/POI JSON at `../../indoor-map-tiles` / `../../indoor-map-api` (two levels above `apps/dashboard/` — see `server/paths.ts`). **Not currently populated in this repo or its Docker image** — those directories only exist in the old `orienta_v2_step2` checkout. Leaving both vars empty today means the indoor map has no tile/POI source until you vendor those assets into that path yourself. |
| **B — External** (the mode actually used today) | `http://127.0.0.1:7801` / `http://127.0.0.1:3001` | Server proxies `/indoor-map` and `/indoor-map-api` to a running map server + POI API. This is what local dev and the current deploy examples assume. |

`VITE_LOCAL_AIRPORT_MAP=1` serves `airport-map.html` from the repo checkout (dev).

## Security (production)

Set in `apps/dashboard/.env` (or via `deploy.example.env`):

```dotenv
TOURIST_ALLOWED_ORIGINS=   # CORS allowlist for tourist-position (empty = same-origin only)
```

- Passenger APIs/WS **require a valid session JWT** — there is no legacy passenger-id
  impersonation fallback, and no built-in demo admin login.
- Admin auth uses an **httpOnly cookie** only; the browser never stores the JWT in `sessionStorage`.
- **RBAC:** admin tokens carry a `role` (`admin` / `ops` / `viewer`). Passenger
  create/update needs `admin`/`ops`; delete needs `admin`. Use `requireRole(...)` for new routes.
- **Admin passwords** may be stored as scrypt hashes in `ADMIN_CREDENTIALS`
  (`email:scrypt$<salt>$<hash>`). Generate one with:
  ```bash
  npm run build:server
  node dist-server/server/scripts/hashAdminPassword.js 'your-password'
  ```
- **Premium pax accounts** seed from `PAX_ACCOUNT_CREDENTIALS` on first boot, then
  manage at runtime via the admin API:
  ```bash
  # list / create-or-reset / delete (admin cookie required)
  GET    /api/pax/accounts
  POST   /api/pax/accounts        { "email": "...", "password": "...", "displayName": "..." }
  DELETE /api/pax/accounts/:email
  ```
- The expensive `/api/orienta/pek-merged-video` route is rate-limited (10/min/IP).

## Data backup (SQLite)

All persistent state (passengers, accounts, chat, audit) lives in one SQLite file
(`DB_PATH`, default `./data/passengers.db`; `/app/data/passengers.db` in Docker,
on the `orienta-data` volume).

```bash
# Online, consistent snapshot (safe while the server runs — uses WAL):
sqlite3 ./data/passengers.db ".backup './backups/passengers-$(date +%F).db'"

# Docker volume:
docker compose exec orienta \
  sqlite3 /app/data/passengers.db ".backup '/app/data/passengers-$(date +%F).db'"

# Restore (server stopped):
cp ./backups/passengers-YYYY-MM-DD.db ./data/passengers.db
```

Schedule the `.backup` command via cron/systemd-timer and ship the file off-box.
Snapshot the `orienta-data` volume as a coarser fallback.

## Horizontal scale-out (Postgres + Redis)

Single-machine deploys need nothing here — the server uses SQLite + in-memory
state by default. To run **2+ app instances** behind a load balancer, point them
at shared Postgres + Redis (the data access layer and the WS/presence/rate-limit
coordination are backend-agnostic):

| Var | Effect |
|-----|--------|
| `DATABASE_URL` | `postgres://…` → all persistence uses Postgres instead of SQLite (P2-1) |
| `REDIS_URL` | `redis://…` → cross-instance WS fan-out, shared presence, shared rate limit (P2-3) |
| `VIDEO_OUTPUT_DIR` | shared volume path where the video worker writes merged mp4s (P2-4) |

Bundled stack (Postgres, Redis, and the video worker) ships under the `scale`
Compose profile:

```bash
# Bring up Postgres + Redis + the video-merge worker alongside the app:
DATABASE_URL=postgres://orienta:orienta@postgres:5432/orienta \
REDIS_URL=redis://redis:6379 \
VIDEO_OUTPUT_DIR=/shared/video \
docker compose --profile scale up -d --build
```

Notes:
- Tables auto-migrate on boot (`db_ready` log shows `dialect` + `redis`).
- `GET /health` reports `db_dialect` (`sqlite`/`pg`) and pings the active DB.
- Video merges run in `orienta-video-worker` (separate container); the web process
  only enqueues and serves the result. Without Redis the merge runs as a
  non-blocking child process in the web container.
- Known single-instance-only state (live updates still propagate via the bus):
  in-memory one-way push `msg`/ack records and trajectory snapshots.

## Error tracking (P2-5)

Optional Sentry integration. Leave the DSNs empty to disable — errors still go to
the structured logger, and the app runs with no external dependency.

| Var | Effect |
| --- | --- |
| `SENTRY_DSN` | Backend SDK (`@sentry/node`): Express errors, `unhandledRejection`/`uncaughtException`, captured + flushed on shutdown |
| `VITE_SENTRY_DSN` | Browser SDK (`@sentry/react`): React `ErrorBoundary` + uncaught client errors |
| `SENTRY_ENVIRONMENT` | Optional; defaults to `NODE_ENV` / Vite `MODE` |
| `SENTRY_RELEASE` / `VITE_SENTRY_RELEASE` | Optional release tag for grouping |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional perf sampling `0..1` (default `0` = errors only) |

When enabled, the `error_tracking_ready` log line is emitted at boot; events are
tagged with the `INSTANCE_ID` so multi-instance deploys are distinguishable.

## Production

```bash
cd apps/dashboard
npm run build
npm run build:server
PORT=5174 npm start
```

See `PASSENGER_PRODUCTION_WORKLOG.md` for production readiness checklist.
