#!/usr/bin/env python3
"""
Build one merged route MP4 from PEK_gate_timestamp.csv + per-scene clips (trim + concat).

CSV columns: point_of_interest, floor, video, video_time
Each row is a cue point at video_time within that row's `video` asset.

Contiguous rows with the same `video` name form one segment: extract [t_min, t_max]
from that source file (seconds, inclusive of last frame ~ use -to t_max).

ffmpeg reads each {video}.mp4 and writes --out only; source files are not modified.

Requires: ffmpeg on PATH. Source clips: {SRC_DIR}/{video}.mp4

Usage:
  python3 scripts/concat_pek_video_from_csv.py \\
    --csv vite/public/route_site/PEK_gate_timestamp.csv \\
    --src-dir vite/public/route_site \\
    --out vite/public/route_site/PEK_gate_timestamp_merged.mp4
"""
from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_time(s: str) -> float:
    s = (s or "").strip().replace("，", ",")
    parts = [p.strip() for p in s.split(":")]
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(s) if s else 0.0


def normalize_gate(s: str) -> str:
    t = (s or "").strip().upper()
    t = re.sub(r"\s+", "", t)
    t = t.replace("GATE_", "")
    if t.startswith("GATE"):
        t = t[4:]
    return t


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--src-dir", required=True, type=Path, help="Directory of {video}.mp4 from CSV")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--reencode", action="store_true", help="Re-encode instead of -c copy (safer if clips differ)")
    ap.add_argument("--from-gate", default="", help="Start gate, e.g. E32")
    ap.add_argument("--to-gate", default="", help="End gate, e.g. E25")
    ap.add_argument("--from-index", type=int, default=-1, help="CSV row index (0-based, incl. header skipped)")
    ap.add_argument("--to-index", type=int, default=-1, help="CSV row index end (inclusive)")
    args = ap.parse_args()

    if not args.csv.is_file():
        print(f"error: csv not found: {args.csv}", file=sys.stderr)
        return 1
    src_dir: Path = args.src_dir.expanduser().resolve()
    if not src_dir.is_dir():
        print(f"error: src-dir not a directory: {src_dir}", file=sys.stderr)
        return 1

    rows: list[dict[str, object]] = []
    with args.csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            if not r:
                continue
            # Headers like "point_of_interest, floor, video" → DictReader keys may be " video"
            r2 = {(k or "").strip(): (v if v is None else str(v).strip()) for k, v in r.items()}
            video = (r2.get("video") or "").strip()
            if not video or video.lower() == "video":
                continue
            vt = r2.get("video_time") or r2.get("time") or "0"
            poi = r2.get("point_of_interest") or r2.get("poi") or r2.get("gate") or ""
            rows.append(
                {
                    "video": video,
                    "time": parse_time(vt),
                    "gate": normalize_gate(str(poi)),
                }
            )

    if len(rows) < 2:
        print("error: need at least 2 data rows in csv", file=sys.stderr)
        return 1

    if args.from_index >= 0 and args.to_index >= 0:
        if args.from_index >= args.to_index or args.to_index >= len(rows):
            print(
                f"error: invalid index range: from-index={args.from_index} to-index={args.to_index} (rows={len(rows)})",
                file=sys.stderr,
            )
            return 1
        rows = rows[args.from_index : args.to_index + 1]
    else:
        from_gate = normalize_gate(args.from_gate)
        to_gate = normalize_gate(args.to_gate)
        if from_gate and to_gate:
            from_idx = -1
            to_idx = -1
            for ii in range(len(rows) - 1, -1, -1):
                if str(rows[ii].get("gate") or "") != from_gate:
                    continue
                jj = ii + 1
                while jj < len(rows):
                    if str(rows[jj].get("gate") or "") == to_gate:
                        from_idx = ii
                        to_idx = jj
                        break
                    jj += 1
                if from_idx >= 0:
                    break
            if from_idx < 0 or to_idx < 0 or from_idx >= to_idx:
                print(
                    f"error: cannot find valid gate range in csv: from={from_gate} to={to_gate}",
                    file=sys.stderr,
                )
                return 1
            rows = rows[from_idx : to_idx + 1]

    runs: list[tuple[str, float, float]] = []
    i = 0
    while i < len(rows):
        v = str(rows[i]["video"])
        t0 = float(rows[i]["time"])
        t_min, t_max = t0, t0
        i += 1
        while i < len(rows) and str(rows[i]["video"]) == v:
            tt = float(rows[i]["time"])
            t_min = min(t_min, tt)
            t_max = max(t_max, tt)
            i += 1
        if t_max <= t_min:
            t_max = t_min + 0.1
        runs.append((v, t_min, t_max))

    tmp = Path(tempfile.mkdtemp(prefix="pek_concat_"))
    seg_paths: list[Path] = []
    try:
        for idx, (video, t_min, t_max) in enumerate(runs):
            clip = src_dir / f"{video}.mp4"
            if not clip.is_file():
                clip_l = src_dir / f"{video.lower()}.mp4"
                clip = clip_l if clip_l.is_file() else clip
            if not clip.is_file():
                print(f"error: missing clip for video={video!r}: expected {clip}", file=sys.stderr)
                return 1
            seg = tmp / f"seg_{idx:03d}.mp4"
            vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k"]
            if args.reencode:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    str(t_min),
                    "-to",
                    str(t_max),
                    "-i",
                    str(clip),
                    *vcodec,
                    str(seg),
                ]
            else:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    str(t_min),
                    "-to",
                    str(t_max),
                    "-i",
                    str(clip),
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    str(seg),
                ]
            print(" ".join(cmd))
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(r.stderr or r.stdout, file=sys.stderr)
                return r.returncode or 1
            seg_paths.append(seg)

        list_file = tmp / "concat.txt"
        lines = []
        for p in seg_paths:
            lines.append(f"file '{p.as_posix()}'")
        list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

        args.out.parent.mkdir(parents=True, exist_ok=True)
        cmd2 = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(args.out),
        ]
        print(" ".join(cmd2))
        r2 = subprocess.run(cmd2, capture_output=True, text=True)
        if r2.returncode != 0:
            print(r2.stderr or r2.stdout, file=sys.stderr)
            print("hint: retry with --reencode if concat -c copy failed (codec/timestamp mismatch)", file=sys.stderr)
            return r2.returncode or 1
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)

    sz = args.out.stat().st_size
    if args.from_index >= 0 and args.to_index >= 0:
        scope = f" idx={args.from_index}..{args.to_index}"
    else:
        fg = normalize_gate(args.from_gate)
        tg = normalize_gate(args.to_gate)
        scope = f" from={fg} to={tg}" if fg and tg else ""
    print(f"OK: {args.out} ({sz} bytes), {len(runs)} segments from {args.csv.name}{scope}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
