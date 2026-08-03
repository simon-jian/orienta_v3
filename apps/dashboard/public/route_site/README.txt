PEK route video (CSV-driven trim + merge)
=========================================

The video page expects **one merged file** whose timeline matches
**PEK_gate_timestamp_full_with_E24_E36.csv** (the canonical CSV — see
apps/dashboard/config/airports/pek.yaml and server/paths.ts; a shorter,
now-deleted PEK_gate_timestamp.csv used to exist here and was never the file
the runtime actually reads). That CSV is produced **offline** from your
per-scene **source clips** (read-only inputs); ffmpeg **never overwrites**
those originals.

Default merged output (same folder as the CSV)
-----------------------------------------------
  apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4

The page loads it by **relative URL** (same directory as index.html). Legacy name
**pek_videoroute_E.MP4** is still accepted if present.

Build merged MP4 (ffmpeg + Python 3)
--------------------------------------
From **orienta_v3** (repo root):

  python3 scripts/concat_pek_video_from_csv.py \
    --csv apps/dashboard/public/route_site/PEK_gate_timestamp_full_with_E24_E36.csv \
    --src-dir apps/dashboard/public/route_site \
    --out apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4

**CLIPS_DIR** must contain every **{video}.mp4** named in the CSV `video` column
(e.g. PEK_T3E_F3_E24_E36.mp4, …). Each contiguous block of rows with the same
`video` value becomes one trimmed segment; segments are concatenated in CSV order.

If concat fails with stream errors, try re-encode:

  python3 scripts/concat_pek_video_from_csv.py \
    --csv apps/dashboard/public/route_site/PEK_gate_timestamp_full_with_E24_E36.csv \
    --src-dir apps/dashboard/public/route_site \
    --out apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4 \
    --reencode

In production, the same concat script normally runs on-demand via the merged-
video job service instead (server/services/videoMerge.ts +
scripts/pek_video_worker.py) — this manual invocation is for local dev/testing
or regenerating the checked-in default merged file.

Dev server (`npm run dev` in apps/dashboard/) serves **public/** directly.
