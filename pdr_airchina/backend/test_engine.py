"""Basic regression coverage for the PDR engine's core contract."""
import math

from backend.engine import PdrEngine, wrap_deg


def test_reset_seeds_the_given_heading() -> None:
    engine = PdrEngine()
    engine.reset(0.0, initial_heading_deg=90.0)
    assert engine.state.heading_fused_deg == 90.0


def test_process_frame_returns_a_well_formed_pose_update() -> None:
    engine = PdrEngine()
    engine.reset(0.0)
    pose = engine.process_frame({
        "t_ms": 100,
        "acc_including_g": {"x": 0.0, "y": 0.0, "z": 9.8},
        "rotation_rate": {"alpha": 0.0},
        "orientation": {},
    })
    assert pose["type"] == "pose_update"
    assert set(["position", "raw_position", "matched_position"]).issubset(pose)
    assert isinstance(pose["step_count"], int)
    assert isinstance(pose["distance_m"], float)


def test_process_frame_never_raises_on_missing_or_malformed_fields() -> None:
    engine = PdrEngine()
    engine.reset(0.0)
    # No exception for a frame missing every optional field.
    pose = engine.process_frame({})
    assert pose["type"] == "pose_update"
    # Nor for one with wrong-typed junk in the optional fields.
    pose2 = engine.process_frame({
        "t_ms": "not-a-number",
        "acc_including_g": {"x": "nope", "y": None, "z": []},
        "rotation_rate": {"alpha": "nope"},
        "orientation": {"alpha": "nope", "webkitCompassHeading": "nope"},
    })
    assert pose2["type"] == "pose_update"


def test_heading_fuses_toward_gyro_integrated_yaw_rate() -> None:
    engine = PdrEngine()
    engine.reset(0.0, initial_heading_deg=0.0)
    # A sustained positive yaw rate over real time should rotate the fused
    # heading away from 0 (exact value depends on internal gains/turn-mode
    # boosts, so this only pins the direction/non-triviality of the effect).
    heading_before = engine.state.heading_fused_deg
    for i in range(1, 6):
        engine.process_frame({
            "t_ms": i * 50,
            "rotation_rate": {"alpha": 60.0},
            "acc_including_g": {"x": 0.0, "y": 0.0, "z": 9.8},
        })
    assert engine.state.heading_fused_deg != heading_before


def test_wrap_deg_normalizes_into_0_360() -> None:
    assert wrap_deg(0.0) == 0.0
    assert wrap_deg(360.0) == 0.0
    assert wrap_deg(-10.0) == 350.0
    assert wrap_deg(370.0) == 10.0
    assert 0.0 <= wrap_deg(-1000.0) < 360.0
    assert not math.isnan(wrap_deg(720.5))
