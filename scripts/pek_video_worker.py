#!/usr/bin/env python3
"""
PEK video-merge worker (P2-4).

Consumes merge jobs from a Redis list and runs the (CPU-heavy) ffmpeg concat in a
process separate from the web server. The web server enqueues jobs and polls for
the output file on a shared volume; this worker writes that file.

Job format (JSON, pushed to LIST `orienta:video:jobs`):
    {"outName": "PEK_..._idx_22_to_30.mp4",
     "spec": {"mode": "index", "fromIdx": 22, "toIdx": 30}}
  or
     "spec": {"mode": "gate", "from": "E32", "to": "E25"}

Status is reported in key `orienta:video:status:<outName>`:
    queued | running | done | failed:<message>

Environment:
    REDIS_URL          required, e.g. redis://redis:6379
    VIDEO_OUTPUT_DIR   required, shared with the web server
    VIDEO_SOURCE_DIR   required, holds the CSV + source {video}.mp4 clips
    VIDEO_CSV_NAME     default PEK_gate_timestamp_full_with_E24_E36.csv
    CONCAT_SCRIPT      default /app/scripts/concat_pek_video_from_csv.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

try:
    import redis  # type: ignore
except ImportError:  # pragma: no cover
    print("error: redis-py not installed (pip install redis)", file=sys.stderr)
    sys.exit(1)

QUEUE_KEY = "orienta:video:jobs"
STATUS_PREFIX = "orienta:video:status:"
STATUS_TTL_S = 600
JOB_TIMEOUT_S = 120


def log(event: str, **fields: object) -> None:
    payload = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "msg": event, **fields}
    print(json.dumps(payload), flush=True)


def selector_args(spec: dict) -> list[str]:
    if spec.get("mode") == "index":
        return ["--from-index", str(int(spec["fromIdx"])), "--to-index", str(int(spec["toIdx"]))]
    return ["--from-gate", str(spec.get("from", "")), "--to-gate", str(spec.get("to", ""))]


def has_valid_duration(path: str) -> bool:
    """True if ffprobe reports a positive duration for `path`.

    A truncated/corrupt ffmpeg output can still be a nonzero-size file — the
    size-only check this replaces would report the job "done" and the web
    process would serve it to a passenger as a finished video. Mirrors
    server/services/videoMerge.ts's hasValidDuration() on the Node side
    (used for the no-Redis, single-machine fallback).

    Fails open (returns True) only if ffprobe itself can't be found — it
    ships in the same `ffmpeg` package this whole worker already requires,
    so a missing binary is a deployment problem, not a reason to fail every
    job.
    """
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True, text=True, timeout=10,
        )
    except FileNotFoundError:
        log("ffprobe_not_found", note="skipping video duration validation")
        return True
    except Exception as exc:  # noqa: BLE001
        log("ffprobe_failed", path=path, error=str(exc)[-300:])
        return False
    if proc.returncode != 0:
        return False
    try:
        duration = float(json.loads(proc.stdout).get("format", {}).get("duration", ""))
    except (ValueError, TypeError, json.JSONDecodeError):
        return False
    return duration > 0


def run_job(job: dict, *, output_dir: str, source_dir: str, csv_path: str, script: str) -> None:
    out_name = str(job["outName"])
    spec = dict(job["spec"])
    out_path = os.path.join(output_dir, out_name)
    args = [
        sys.executable, script,
        "--csv", csv_path,
        "--src-dir", source_dir,
        "--out", out_path,
        *selector_args(spec),
    ]
    log("video_job_start", outName=out_name, spec=spec)
    proc = subprocess.run(args, capture_output=True, text=True, timeout=JOB_TIMEOUT_S)
    if proc.returncode == 0 and os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
        if not has_valid_duration(out_path):
            raise RuntimeError("merge produced a file with no valid video duration (corrupt/truncated output)")
        log("video_job_done", outName=out_name, bytes=os.path.getsize(out_path))
        return
    detail = (proc.stderr or proc.stdout or "merge_failed")[-800:]
    raise RuntimeError(detail)


def main() -> int:
    redis_url = os.environ.get("REDIS_URL", "").strip()
    output_dir = os.environ.get("VIDEO_OUTPUT_DIR", "").strip()
    source_dir = os.environ.get("VIDEO_SOURCE_DIR", "").strip()
    csv_name = os.environ.get("VIDEO_CSV_NAME", "PEK_gate_timestamp_full_with_E24_E36.csv").strip()
    script = os.environ.get("CONCAT_SCRIPT", "/app/scripts/concat_pek_video_from_csv.py").strip()

    if not redis_url or not output_dir or not source_dir:
        print("error: REDIS_URL, VIDEO_OUTPUT_DIR and VIDEO_SOURCE_DIR are required", file=sys.stderr)
        return 1

    os.makedirs(output_dir, exist_ok=True)
    csv_path = os.path.join(source_dir, csv_name)
    r = redis.Redis.from_url(redis_url, decode_responses=True)
    log("video_worker_ready", queue=QUEUE_KEY, output_dir=output_dir, source_dir=source_dir)

    while True:
        try:
            popped = r.blpop(QUEUE_KEY, timeout=5)
            if not popped:
                continue
            _key, raw = popped
            job = json.loads(raw)
            out_name = str(job.get("outName", ""))
            if not out_name:
                continue
            status_key = STATUS_PREFIX + out_name
            r.set(status_key, "running", ex=STATUS_TTL_S)
            try:
                run_job(job, output_dir=output_dir, source_dir=source_dir, csv_path=csv_path, script=script)
                r.set(status_key, "done", ex=STATUS_TTL_S)
            except Exception as exc:  # noqa: BLE001 - report, keep serving
                msg = str(exc).replace("\n", " ")[-500:]
                log("video_job_failed", outName=out_name, error=msg)
                r.set(status_key, f"failed:{msg}", ex=STATUS_TTL_S)
        except KeyboardInterrupt:
            log("video_worker_stopping")
            return 0
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            log("video_worker_error", error=str(exc)[-300:])
            time.sleep(1)


if __name__ == "__main__":
    raise SystemExit(main())
