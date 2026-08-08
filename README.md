# Orienta v3

Passenger + admin dashboard for airport indoor navigation and operations.

**Hub scope:** PEK T3E only (SFO airport demo removed 2026-06). See [`PRODUCTION_ROADMAP.md`](./PRODUCTION_ROADMAP.md) and [`HARDCODED_VALUES.md`](./HARDCODED_VALUES.md).

## Layout

```text
orienta_v3/
  apps/dashboard/     # React + Express app (main product)
  *.md                # Architecture and production worklogs
```

Related services (separate repos, run alongside this one):

| Service | Purpose | Default port |
|---------|---------|--------------|
| `apps/dashboard` | Admin UI, passenger `/pax`, WebSocket hub | 5174 / 5175 (dev) |
| [`pedestrian_dead_reckoning`](../pedestrian_dead_reckoning) | Python PDR (IMU → route-following trajectory) | 8000 |
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
- `/route_site` — **retired** (video navigation removed; page redirects users to `/pax/app`)

### PDR (pedestrian dead reckoning)

PDR is an **independent service** — a separate repo
([`pedestrian_dead_reckoning`](../pedestrian_dead_reckoning), checked out as a
sibling of this one), not something this repo builds or vendors. It owns the
entire algorithm (step detection + planned-route following); orienta only
ever talks to it over its HTTP/WebSocket API:

1. **Python service** (sibling repo) — `POST /api/session` (requires a
   `planned_path`, ≥2 points), `WS /ws/pdr/{id}` (`sensor_motion` in,
   `pose_update` out — see that repo's `backend/README.md` for the wire
   protocol)
2. **Node proxy** — browser calls `/pdr-api/*` → `PDR_API_ORIGIN`
3. **Browser client** — `public/orienta-pdr-client.js` used from `/pax/app`
   **Start PDR** — a thin client only; no algorithm logic lives here

Unlike the old `pdr_airchina` engine this replaced, there's no free-walk
mode: position and heading come purely from progress along a pre-planned
route, so a session can't start without one. `/pax/app` gets that route from
the embedded indoor map's gate-to-gate routing
(`gateFrom`/`gateTo` → `orienta-nav-path-lonlat`) — so **PDR only works where
the map can already compute a route**. Image-based corridor views live in the
map / PDR stacks, not in this dashboard repo. Video route navigation (mp4
merge + `/route_site` player) was removed.

```bash
# Terminal 3 — from apps/dashboard, runs the sibling checkout via uvicorn
npm run pdr:dev
```

If you don't have `pedestrian_dead_reckoning` checked out as a sibling
directory, run it however that repo's own README describes and just point
`PDR_API_ORIGIN` at it. Either way, that service also needs
`PDR_ALLOWED_ORIGINS` set to this app's origin (e.g.
`http://localhost:5175` in dev) so its WebSocket same-origin check accepts
connections proxied through `/pdr-api` — see its `backend/README.md`.

Verify: `curl http://localhost:5175/pdr-api/health` (dev) or `curl http://localhost:5174/pdr-api/health` (prod).

## Docker (dashboard)

PDR and the indoor map are **not** part of this compose file — deploy them
separately and point `PDR_API_ORIGIN` / `INDOOR_MAP_*` at them. Compose only
runs the dashboard (plus optional `--profile scale` Postgres/Redis/worker).

```bash
# from orienta_v3 root — copy deploy.example.env, fill REAL secrets
# (JWT_SECRET, scrypt ADMIN_CREDENTIALS, KIOSK_SCAN_SECRET, map upstreams)
cp deploy.example.env .env   # or pass --env-file deploy.example.env
docker compose --env-file .env up -d --build
```

`--env-file` feeds Compose variable substitution; `docker-compose.yml`'s
`environment:` block is what actually injects those values into the container
(including `KIOSK_SCAN_SECRET` — required for production boot).

Admin: http://localhost:5174

### External service topology (production)

| Service | Env on dashboard | Notes |
|---------|------------------|-------|
| Indoor map UI | `INDOOR_MAP_UPSTREAM` | Required for nav + PDR routes (Mode B). Default local `:7801`. |
| Indoor map API | `INDOOR_MAP_API_UPSTREAM` | POI / zones. Default local `:3001`. |
| PDR | `PDR_API_ORIGIN` | Sibling repo service root (e.g. `:8000`). Also set that service's `PDR_ALLOWED_ORIGINS` to this app's public origin so proxied WS `/pdr-api` is accepted. |

Dashboard `/health` can be `ok` while `indoor_map` / `pdr_proxy` report
`unavailable` / `unreachable` / `disabled` — those are soft checks.

## Health check

| Endpoint | Meaning |
|----------|---------|
| `GET /livez` | Process alive only (no dependency I/O). **Docker `HEALTHCHECK` uses this.** |
| `GET /readyz` / `GET /health` | DB + Redis (when configured) hard; PDR / indoor-map soft status |

```bash
curl http://localhost:5174/health
# {"status":"ok","checks":{"process":"ok","db":"ok","db_dialect":"sqlite","redis":"disabled","pdr_proxy":"disabled","indoor_map":"unavailable",...}}
```

`indoor_map` values: `ok` (Mode B reachable) · `unreachable` · `bundled` (Mode A
assets on disk) · `unavailable` (neither). Returns `200` when DB (+ Redis if
configured) is up, `503` when degraded.

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

Helper (host with `sqlite3` installed):

```bash
./scripts/backup-sqlite.sh ./apps/dashboard/data/passengers.db ./backups
```

### Postgres backup (`--profile scale`)

```bash
docker compose --profile scale exec postgres \
  pg_dump -U orienta orienta > "backups/orienta-$(date +%F).sql"
```

## Horizontal scale-out (Postgres + Redis)

Single-machine deploys need nothing here — the server uses SQLite + in-memory
state by default. To run **2+ app instances** behind a load balancer, point them
at shared Postgres + Redis (the data access layer and the WS/presence/rate-limit
coordination are backend-agnostic):

| Var | Effect |
|-----|--------|
| `DATABASE_URL` | `postgres://…` → all persistence uses Postgres instead of SQLite (P2-1) |
| `REDIS_URL` | `redis://…` → cross-instance WS fan-out, shared presence, shared rate limit (P2-3) |

Bundled Postgres + Redis ship under the `scale` Compose profile:

```bash
# Use strong passwords (production refuses DATABASE_URL with password "orienta").
DATABASE_URL=postgres://orienta:STRONG@postgres:5432/orienta \
REDIS_PASSWORD=STRONG_REDIS \
REDIS_URL=redis://:STRONG_REDIS@redis:6379 \
docker compose --profile scale up -d --build
```

Notes:
- Tables auto-migrate on boot (`db_ready` log shows `dialect` + `redis`).
- `GET /health` reports `db_dialect` (`sqlite`/`pg`) and pings the active DB.
- Postgres/Redis host ports bind to `127.0.0.1` only; set `REDIS_PASSWORD` for
  anything beyond local play and put the same password in `REDIS_URL`.
- Known single-instance-only state (live updates still propagate via the bus):
  in-memory one-way push `msg`/ack records and trajectory snapshots.

## Error tracking (P2-5)

Optional Sentry integration. Leave the DSNs empty to disable — errors still go to
the structured logger, and the app runs with no external dependency.

| Var | Effect |
| --- | --- |
| `SENTRY_DSN` | Backend SDK (`@sentry/node`): Express errors, `unhandledRejection`/`uncaughtException`, captured + flushed on shutdown |
| `VITE_SENTRY_DSN` | Browser SDK (`@sentry/react`) — **bake-time only** (Vite inlines at `npm run build`); setting it in Compose on an already-built image has no effect |
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

**This alone does not restart the process if it crashes or the host reboots.**
Docker (above) already has this via `restart: unless-stopped` in
`docker-compose.yml` — outside Docker, put a process supervisor in front of
`npm start` (equivalently `node dist-server/server/server.js`). Two common
options:

<details>
<summary>systemd (Linux)</summary>

```ini
# /etc/systemd/system/orienta-dashboard.service
[Unit]
Description=Orienta dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/orienta_v3/apps/dashboard
EnvironmentFile=/opt/orienta_v3/apps/dashboard/.env
ExecStart=/usr/bin/node dist-server/server/server.js
Restart=always
RestartSec=2
User=orienta

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now orienta-dashboard
```
</details>

<details>
<summary>PM2 (Node-native, cross-platform)</summary>

```bash
npm install -g pm2
cd apps/dashboard
pm2 start dist-server/server/server.js --name orienta-dashboard
pm2 save
pm2 startup   # prints the command to auto-start pm2 itself on boot
```
</details>

See `PASSENGER_PRODUCTION_WORKLOG.md` for production readiness checklist.
