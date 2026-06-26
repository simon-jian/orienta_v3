# Passenger Production Worklog

> Last updated: 2026-06-13  
> Project: `orienta_v3/apps/dashboard`  
> Goal: move the passenger flow from demo-style URLs/static pages toward a production-ready passenger/admin system.

---

## What Changed In This Session

### 1. Local Launch And Map Defaults

The dashboard now uses a clearer local split:

- Frontend Vite dev server: `http://localhost:5173`
- Express backend: `http://localhost:5175`
- Indoor map page proxy: `/indoor-map` -> `http://127.0.0.1:7801`
- Indoor map API proxy: `/indoor-map-api` -> `http://127.0.0.1:3001`

The backend no longer depends on a hard-coded local file path for `airport-map.html` during normal development. The expected local map URL is:

```text
http://localhost:7801/airport-map.html
```

Relevant files:

- `apps/dashboard/package.json`
- `apps/dashboard/vite.config.ts`
- `apps/dashboard/.env`
- `apps/dashboard/.env.example`
- `.env.example`
- `apps/dashboard/server/config.ts`
- `apps/dashboard/src/config/indoorMap.ts`

### 2. Legacy Code Separation

Unused active-source code was moved out of `src/`:

- `apps/dashboard/src/components/GateCard.tsx` was removed.
- `apps/dashboard/legacy/components/GateCard.tsx` keeps the old component for reference.
- `apps/dashboard/legacy/README.md` explains how to treat legacy code.

### 3. Production-Style Passenger Session API

A new passenger session flow was added under `/api/pax`.

Supported entry modes:

- `POST /api/pax/scan`
  - For boarding-pass QR / BCBP payloads.
  - Creates a temporary premium passenger session.

- `POST /api/pax/basic-session`
  - For manual passenger entry.
  - Creates a temporary basic/free passenger session.

- `POST /api/pax/account-login`
  - For registered premium passenger login.
  - Currently uses `PAX_ACCOUNT_CREDENTIALS` from `.env` for local development.
  - This must become a real account table with password hashing before production.

- `GET /api/pax/session`
  - Validates a backend-issued passenger JWT session token.

Relevant files:

- `apps/dashboard/server/routes/paxSessions.ts`
- `apps/dashboard/server/passengers/bcbpParser.ts`
- `apps/dashboard/server/passengers/paxSessionToken.ts`
- `apps/dashboard/server/passengers/PassengerRegistry.ts`
- `apps/dashboard/server/server.ts`
- `apps/dashboard/src/features/pax/session.ts`

### 4. New React Passenger Entry And App

The production passenger path is now:

```text
http://localhost:5173/pax
```

After login/session creation, the React passenger app is:

```text
http://localhost:5173/pax/app
```

`/pax` remains the stable login/entry URL. It can still fall back to the old `PaxEntryWrapper` when legacy demo query params are present.

The new `/pax/app` handles:

- passenger session validation
- passenger identity display
- basic vs premium capabilities
- WebSocket connection with session metadata
- notifications
- operator chat for premium passengers
- embedded indoor map
- live trajectory sharing from map iframe to backend
- authenticated HTTP fallback for presence/location

Relevant files:

- `apps/dashboard/src/features/pax/PaxEntryPage.tsx`
- `apps/dashboard/src/features/pax/PaxAppPage.tsx`
- `apps/dashboard/src/app/App.tsx`
- `apps/dashboard/src/services/realtime.ts`

### 5. Passenger HTTP Fallback Token Guard

Passenger HTTP fallback routes now support Bearer token verification.

For the new React `/pax/app`, requests include:

```http
Authorization: Bearer <passenger-session-token>
```

Protected/checked routes include:

- `/api/pax/presence`
- `/api/pax/tourist-position`
- `/api/pax/chat-send`
- `/api/pax/subscribe`
- `/api/pax/away`
- `/api/pax/back`

Current behavior:

- If a token is present, the server validates it.
- If the token passenger/tenant does not match the request body, the server returns `403 session_identity_mismatch`.
- Basic/free passengers cannot send normal text chat through HTTP fallback.
- Basic/free passengers can still send `kind=location`.
- No-token requests are temporarily allowed for legacy static passenger pages.

Relevant files:

- `apps/dashboard/server/routes/push.ts`
- `apps/dashboard/server/passengers/paxSessionToken.ts`
- `apps/dashboard/src/features/pax/PaxAppPage.tsx`

---

## Current Production Readiness

This is now a production skeleton, not a complete production system.

Completed foundations:

- backend-issued passenger session tokens
- separate QR/basic/account login paths
- temporary vs registered account distinction
- basic vs premium capability model
- React passenger app shell
- map iframe embedded into React passenger app
- passenger trajectory forwarding to admin/backend
- authenticated HTTP fallback for new React passenger app

Still missing before real production:

- real passenger account database
- password hashing and account lifecycle
- temporary session cleanup job
- persistent chat/location/message storage
- stronger admin/operator role permissions (RBAC)
- audit logs
- rate limiting
- monitoring/alerts
- real flight/gate/boarding data integration
- fully React-native navigation UI instead of iframe-based map integration
- automated test coverage for session/capability/auth flows

Completed in security hardening (2026-06):

- WebSocket passenger session token verification
- WebSocket admin cookie verification (`orienta_admin_token`)
- Protected `/api/orienta/admin-presence` (requireAdmin)
- Protected `/api/tourist-deactivate` (passenger identity)
- Admin JWT no longer returned to sessionStorage
- `PAX_LEGACY_AUTH=0` and `ORIENTA_ALLOW_DEMO=0` for production
- Unified passenger identity resolver (`server/passengers/paxIdentity.ts`)

Recommended next engineering step:

```text
Replace PAX_ACCOUNT_CREDENTIALS with a real account table and password hashing.
```

---

## How To Continue On Another Computer

### 1. Make Sure The Current Work Is Actually Synced

Important: the current folder did not appear to be a Git repository when checked from:

```text
/home/simon-lennovo-ubuntu/orienta_v3
```

That means another computer will not automatically have these changes unless you sync the full project directory yourself or move the project into Git.

Recommended production workflow:

```bash
git init
git add .
git commit -m "Add passenger production session skeleton"
git remote add origin <your-repo-url>
git push -u origin main
```

If this project already has a Git repository somewhere else, use that real repository root instead. Do not rely on `node_modules` or local terminal state as the source of truth.

Alternative manual workflow:

- copy the full `orienta_v3` directory to the new computer
- exclude `apps/dashboard/node_modules` if the copy is large
- keep `.env` secure and copy it separately

### 2. Install Dependencies

On the new computer:

```bash
cd orienta_v3/apps/dashboard
npm install
```

If install fails because of permissions, remove `node_modules` and install again:

```bash
rm -rf node_modules
npm install
```

### 3. Create Local Environment File

Create:

```text
orienta_v3/apps/dashboard/.env
```

Start from:

```text
orienta_v3/apps/dashboard/.env.example
```

Minimum local values:

```dotenv
JWT_SECRET=<generate-with-openssl-rand-hex-32>
ADMIN_CREDENTIALS=admin@yourairline.com:your-password
PAX_ACCOUNT_CREDENTIALS=premium@orienta.ai:orienta123

INDOOR_MAP_UPSTREAM=http://127.0.0.1:7801
INDOOR_MAP_API_UPSTREAM=http://127.0.0.1:3001
VITE_INDOOR_MAP_URL=/indoor-map/airport-map.html
VITE_INDOOR_MAP_API_BASE=/indoor-map-api
VITE_LOCAL_AIRPORT_MAP=0

ROUTE_SITE_DEFAULT_TENANT=airchina
DB_PATH=./data/passengers.db
```

Generate a JWT secret:

```bash
openssl rand -hex 32
```

### 4. Start The Local Indoor Map Services

The dashboard expects:

```text
http://127.0.0.1:7801/airport-map.html
http://127.0.0.1:3001/api/poi?terminal=T3E
```

Start whatever local map stack provides those two services before testing passenger navigation.

### 5. Start Backend And Frontend

Terminal 1:

```bash
cd orienta_v3/apps/dashboard
npm run dev:server
```

Terminal 2:

```bash
cd orienta_v3/apps/dashboard
npm run dev
```

Open:

```text
http://localhost:5173
http://localhost:5173/pax
```

### 6. Verify The Build

Run:

```bash
cd orienta_v3/apps/dashboard
npx tsc -b --pretty false
npm run build
npm run build:server
```

### 7. Quick Passenger API Smoke Test

With backend and frontend running:

```bash
node - <<'NODE'
async function post(path, body, token) {
  const res = await fetch('http://127.0.0.1:5173' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  console.log(path, res.status, json.ok, json.error || 'ok');
  return json;
}

const created = await post('/api/pax/basic-session', {
  arrivalFlight: 'CA836',
  departureFlight: 'CA837',
  name: 'Smoke Test'
});

const s = created.session;
await post('/api/pax/presence', { online: true }, s.token);
await post('/api/pax/tourist-position', {
  lat: 40.0801,
  lng: 116.5846,
  path: [{ lat: 40.0801, lng: 116.5846 }]
}, s.token);
await post('/api/pax/chat-send', { body: 'hello', kind: 'text' }, s.token);
await post('/api/pax/chat-send', { body: 'near gate', kind: 'location', gateRef: s.passenger.gateId }, s.token);
NODE
```

Expected result:

```text
/api/pax/basic-session 201 true ok
/api/pax/presence 200 true ok
/api/pax/tourist-position 200 true ok
/api/pax/chat-send 403 false chat_not_allowed_for_plan
/api/pax/chat-send 200 true ok
```

---

## Important Notes For Future Work

- Do not treat `.env` as production credential storage.
- Do not keep `PAX_ACCOUNT_CREDENTIALS` as the real premium account system.
- Do not rely on body-provided `passengerId` in production APIs.
- Keep `/pax` as the stable passenger entry URL.
- Keep `/pax/app` as the authenticated React passenger app route.
- Keep legacy `public/pax.html` compatibility only while migration is in progress.
- The next security milestone is WebSocket passenger token verification.
