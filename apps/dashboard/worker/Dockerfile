# PEK video-merge worker (P2-4) — runs ffmpeg concat jobs off the web process.
# Build context: repo root (needs scripts/).
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "redis>=5,<6"

WORKDIR /app
COPY scripts/concat_pek_video_from_csv.py /app/scripts/concat_pek_video_from_csv.py
COPY scripts/pek_video_worker.py /app/scripts/pek_video_worker.py

ENV CONCAT_SCRIPT=/app/scripts/concat_pek_video_from_csv.py
CMD ["python3", "/app/scripts/pek_video_worker.py"]
