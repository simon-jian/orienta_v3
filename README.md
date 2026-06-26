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
- Video + PDR (legacy): http://localhost:5173/pax?pid=TX1&tenant=airchina&view=video

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

## Security (production)

Set in `apps/dashboard/.env`:

```dotenv
PAX_LEGACY_AUTH=0          # require passenger session JWT (disables legacy pax.html impersonation)
ORIENTA_ALLOW_DEMO=0       # disable demo/demo admin login
```

Admin auth uses an **httpOnly cookie** only; the browser never stores the JWT in `sessionStorage`.

## Production

```bash
cd apps/dashboard
npm run build
npm run build:server
PORT=5174 npm start
```

See `PASSENGER_PRODUCTION_WORKLOG.md` for production readiness checklist.
