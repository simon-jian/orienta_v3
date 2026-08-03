import json
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .engine import PdrEngine, safe_float

TILE_SOURCES = [
    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
]

# A session with no activity for this long is treated as abandoned. Kept long
# enough to survive a brief network drop / app backgrounding and reconnect
# with the same session_id (resuming its accumulated PDR state), short enough
# that `sessions` doesn't grow without bound from clients that create a
# session and never open (or drop and never resume) the WebSocket.
SESSION_TTL_S = 2 * 60 * 60


@dataclass
class Session:
    engine: PdrEngine
    created_at: float
    last_seen_at: float = field(default=0.0)

    def __post_init__(self) -> None:
        if not self.last_seen_at:
            self.last_seen_at = self.created_at


app = FastAPI(title="PDR Backend Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


sessions: Dict[str, Session] = {}


def _prune_expired_sessions(now: float) -> int:
    """Drops sessions with no activity in over SESSION_TTL_S. Returns the count removed."""
    expired = [sid for sid, s in sessions.items() if now - s.last_seen_at > SESSION_TTL_S]
    for sid in expired:
        del sessions[sid]
    return len(expired)


@app.get("/health")
def health() -> Dict:
    # Beyond "the process can answer HTTP at all": constructing a PdrEngine
    # exercises corridor-file loading (backend/engine.py CorridorMatcher), so a
    # missing/corrupt corridors.json — which would otherwise only surface on
    # the first real session — fails the health check instead.
    try:
        engine_ok = PdrEngine() is not None
    except Exception:
        engine_ok = False
    return {"ok": engine_ok, "sessions": len(sessions)}


@app.get("/")
def root() -> Dict:
    """API-only service; video UI lives in orienta route_site."""
    return {"service": "orienta-pdr", "health": "/health", "session": "POST /api/session"}


@app.get("/api/tiles/{z:int}/{x:int}/{y:int}")
async def proxy_tile(z: int, x: int, y: int) -> Response:
    """Proxy map tiles for users in China where OSM is blocked."""
    url = random.choice(TILE_SOURCES).format(z=z, x=x, y=y)
    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "PDR-AirChina/1.0 (map-tile-proxy)"},
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            return Response(
                content=r.content,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception:
        return Response(status_code=502)


@app.post("/api/session")
def create_session() -> Dict:
    now = time.time()
    _prune_expired_sessions(now)
    sid = str(uuid.uuid4())
    engine = PdrEngine()
    engine.reset(now * 1000.0)
    sessions[sid] = Session(engine=engine, created_at=now)
    return {"session_id": sid}


@app.websocket("/ws/pdr/{session_id}")
async def ws_pdr(websocket: WebSocket, session_id: str) -> None:
    # Require a session minted by POST /api/session — previously any session_id
    # (e.g. a client-generated UUID with no prior request) silently got a
    # fresh engine here, so opening WebSockets with random ids was an
    # unauthenticated way to create unbounded server-side state.
    session = sessions.get(session_id)
    if session is None:
        await websocket.close(code=4404, reason="unknown_session")
        return
    await websocket.accept()
    session.last_seen_at = time.time()
    engine = session.engine
    try:
        await websocket.send_text(json.dumps({"type": "session_ready", "session_id": session_id}))
        while True:
            payload = await websocket.receive_text()
            session.last_seen_at = time.time()
            try:
                msg = json.loads(payload)
                if not isinstance(msg, dict):
                    continue
                event_type = msg.get("type")
                if event_type == "reset":
                    t_ms = safe_float(msg.get("t_ms"), default=time.time() * 1000.0)
                    initial_heading_deg = msg.get("initial_heading_deg")
                    if not isinstance(initial_heading_deg, (int, float)):
                        initial_heading_deg = None
                    engine.reset(t_ms, initial_heading_deg=initial_heading_deg)
                    await websocket.send_text(json.dumps({"type": "reset_ack"}))
                    continue
                if event_type != "sensor_frame":
                    continue
                pose = engine.process_frame(msg)
                await websocket.send_text(json.dumps(pose))
            except WebSocketDisconnect:
                raise
            except Exception:
                # A single malformed frame (bad JSON, unexpected shape) should
                # not tear down the whole session — skip it and keep the
                # connection (and accumulated PDR state) alive.
                continue
    except WebSocketDisconnect:
        # Deliberately NOT deleted here: a dropped connection (network blip,
        # phone backgrounded) can reconnect with the same session_id and
        # resume its accumulated PDR state (step count, position) instead of
        # restarting from zero. _prune_expired_sessions() reclaims it once
        # SESSION_TTL_S passes with no reconnect.
        return
