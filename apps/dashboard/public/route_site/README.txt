PEK route video (CSV-driven trim + merge)
=========================================

The video page expects **one merged file** whose timeline matches
**PEK_gate_timestamp.csv**. That file is produced **offline** from your per-scene
**source clips** (read-only inputs); ffmpeg **never overwrites** those originals.

Default merged output (same folder as the CSV)
-----------------------------------------------
  apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4

The page loads it by **relative URL** (same directory as index.html). Legacy name
**pek_videoroute_E.MP4** is still accepted if present.

Build merged MP4 (ffmpeg + Python 3)
--------------------------------------
From **orienta_v3/apps/dashboard**:

  python3 ../../../scripts/concat_pek_video_from_csv.py \
    --csv public/route_site/PEK_gate_timestamp.csv \
    --src-dir public/route_site \
    --out public/route_site/PEK_gate_timestamp_merged.mp4

Equivalent from **orienta_v3**:

  python3 scripts/concat_pek_video_from_csv.py \
    --csv apps/dashboard/public/route_site/PEK_gate_timestamp.csv \
    --src-dir apps/dashboard/public/route_site \
    --out apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4

**CLIPS_DIR** must contain every **{video}.mp4** named in the CSV `video` column
(e.g. PEK_T3E_F3_E24_E36.mp4, …). Each contiguous block of rows with the same
`video` value becomes one trimmed segment; segments are concatenated in CSV order.

If concat fails with stream errors, try re-encode:

  python3 scripts/concat_pek_video_from_csv.py \
    --csv apps/dashboard/public/route_site/PEK_gate_timestamp.csv \
    --src-dir apps/dashboard/public/route_site \
    --out apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4 \
    --reencode

Render / CI download
--------------------
**scripts/render-build.sh** downloads a pre-built merged file when **PEK_VIDEO_URL**
is set. Default save path:

  apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4

Override with **PEK_MERGED_OUT** if needed. **Root Directory** on Render must be the
**repository root** (not `vite`) so this script runs before `npm run build`.

Release asset name can be anything; the URL is what curl fetches — the file on disk
uses **PEK_gate_timestamp_merged.mp4** by default.

Local curl example (replace OWNER/REPO/TAG):

  curl -fL -o apps/dashboard/public/route_site/PEK_gate_timestamp_merged.mp4 \
    "https://github.com/OWNER/REPO/releases/download/TAG/your-merged-asset.mp4"

Dev server (`npm run dev` in vite/) serves **public/** directly.
