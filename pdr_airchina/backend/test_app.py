"""
Regression coverage for backend/app.py's session lifecycle.

Before this, POST /api/session was optional in practice: opening a WebSocket
at /ws/pdr/<any-uuid> silently created a fresh session for an id nobody had
ever requested — an unauthenticated way to grow server-side state without
bound. These tests pin down the fixed contract: a session must be created via
POST first, and reconnecting to an existing session resumes its PDR state
rather than resetting it.
"""
import time

from fastapi.testclient import TestClient

from backend.app import SESSION_TTL_S, _prune_expired_sessions, app, sessions


client = TestClient(app)


def setup_function() -> None:
    sessions.clear()


def test_health_reports_ok_and_session_count() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["sessions"] == 0


def test_create_session_returns_a_session_id() -> None:
    resp = client.post("/api/session")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["session_id"], str) and body["session_id"]
    assert body["session_id"] in sessions


def test_websocket_to_an_unknown_session_id_is_rejected() -> None:
    import pytest
    from starlette.websockets import WebSocketDisconnect

    # Server closes immediately (before accepting) with a custom code, rather
    # than accepting the connection and silently minting a new session — the
    # TestClient raises WebSocketDisconnect right at connect time for this.
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws/pdr/this-session-was-never-created"):
            pass
    assert exc_info.value.code == 4404


def test_websocket_to_a_created_session_works_end_to_end() -> None:
    session_id = client.post("/api/session").json()["session_id"]
    with client.websocket_connect(f"/ws/pdr/{session_id}") as ws:
        hello = ws.receive_json()
        assert hello == {"type": "session_ready", "session_id": session_id}

        ws.send_text('{"type": "sensor_frame", "t_ms": 1000}')
        pose = ws.receive_json()
        assert pose["type"] == "pose_update"
        assert "position" in pose


def test_a_malformed_frame_does_not_kill_the_connection() -> None:
    session_id = client.post("/api/session").json()["session_id"]
    with client.websocket_connect(f"/ws/pdr/{session_id}") as ws:
        ws.receive_json()  # session_ready

        ws.send_text("not valid json at all")
        ws.send_text('{"type": "sensor_frame", "t_ms": "not-a-number", "acc_including_g": {"x": "nope"}}')

        # The connection is still alive and processes a normal frame afterward.
        ws.send_text('{"type": "sensor_frame", "t_ms": 1000}')
        pose = ws.receive_json()
        assert pose["type"] == "pose_update"


def test_reconnecting_to_the_same_session_resumes_its_state_instead_of_resetting() -> None:
    session_id = client.post("/api/session").json()["session_id"]
    with client.websocket_connect(f"/ws/pdr/{session_id}") as ws:
        ws.receive_json()  # session_ready
        ws.send_text('{"type": "reset", "t_ms": 0, "initial_heading_deg": 90}')
        ws.receive_json()  # reset_ack

    # Engine object for this session_id is unchanged across the reconnect —
    # this is the whole point of NOT deleting the session on disconnect.
    engine_before = sessions[session_id].engine

    with client.websocket_connect(f"/ws/pdr/{session_id}") as ws:
        hello = ws.receive_json()
        assert hello["session_id"] == session_id

    assert sessions[session_id].engine is engine_before


def test_prune_expired_sessions_removes_only_stale_entries() -> None:
    fresh_id = client.post("/api/session").json()["session_id"]
    stale_id = client.post("/api/session").json()["session_id"]
    sessions[stale_id].last_seen_at = time.time() - SESSION_TTL_S - 60

    removed = _prune_expired_sessions(time.time())

    assert removed == 1
    assert fresh_id in sessions
    assert stale_id not in sessions


def test_create_session_prunes_expired_sessions_as_a_side_effect() -> None:
    stale_id = client.post("/api/session").json()["session_id"]
    sessions[stale_id].last_seen_at = time.time() - SESSION_TTL_S - 60

    client.post("/api/session")  # triggers a prune sweep internally

    assert stale_id not in sessions
