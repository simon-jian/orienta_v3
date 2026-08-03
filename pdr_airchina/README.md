# PDR Air China — backend (in monorepo)

Realtime pedestrian dead reckoning: **FastAPI** + **WebSocket** (`/ws/pdr/{session_id}`), `POST /api/session`, optional OSM tile proxy (`/api/tiles/...`).

The **video page** (`apps/dashboard/public/route_site/`) uses **`orienta-pdr-client.js`**: phone IMU → this service → trajectory on the map. There is **no standalone HTML UI** in this folder.

## Run locally

```bash
cd pdr_airchina
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PORT=10000
python3 run.py
```

From the dashboard's Vite dev server (`apps/dashboard/`), `/pdr-api` proxies to `http://127.0.0.1:10000` (see `apps/dashboard/vite.config.ts`).

## Tests

```bash
pip install -r requirements.txt pytest
python -m pytest backend/ -v
```

Covers the session lifecycle (`POST /api/session` required before a WebSocket
connects — an unknown `session_id` is rejected rather than silently minted;
reconnecting to an existing session resumes its PDR state; malformed frames
are dropped instead of killing the connection) and the core PDR engine
(`backend/engine.py`). Run in CI by `.github/workflows/ci.yml`'s `pdr` job.

## Layout

| Path | Role |
|------|------|
| `run.py` | Uvicorn entry |
| `backend/app.py` | HTTP + WebSocket |
| `backend/engine.py` | PDR algorithm |
| `backend/data/corridors.json` | Corridor graph for map-matching (`?pdrMapMatch=1` on video page) |
| `backend/test_app.py`, `backend/test_engine.py` | pytest coverage |

`requirements.txt` is the single, pinned source of truth for dependencies —
used by both this local setup and the PyInstaller build in `Dockerfile`.

## Render

Deploy as **`orienta-pdr`**. On the **orienta** Node service (`apps/dashboard/`)
set **`PDR_API_ORIGIN`** to the public `https://…` URL of `orienta-pdr` so
`/pdr-api` is proxied (see `apps/dashboard/server/server.ts`).
