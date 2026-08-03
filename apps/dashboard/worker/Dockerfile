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

RUN groupadd --system --gid 1001 orienta \
    && useradd --system --uid 1001 --gid orienta --home-dir /app --no-create-home --shell /usr/sbin/nologin orienta \
    && chown -R orienta:orienta /app
USER orienta

ENV CONCAT_SCRIPT=/app/scripts/concat_pek_video_from_csv.py
# No HTTP endpoint to probe; verify the worker can still reach its queue.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import os,sys,redis; sys.exit(0 if redis.from_url(os.environ['REDIS_URL']).ping() else 1)"
CMD ["python3", "/app/scripts/pek_video_worker.py"]
