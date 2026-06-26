FROM python:3.11-slim-bookworm AS build

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000
ARG ORIENTA_LICENSE_PUBLIC_KEY_B64=
ENV ORIENTA_LICENSE_PUBLIC_KEY_B64=$ORIENTA_LICENSE_PUBLIC_KEY_B64

RUN apt-get update && \
    apt-get install -y --no-install-recommends binutils && \
    rm -rf /var/lib/apt/lists/*

COPY pdr_airchina/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt pyinstaller

COPY pdr_airchina/ ./
RUN python -c "from pathlib import Path; import json, os; Path('backend/license_public_key.py').write_text('ORIENTA_LICENSE_PUBLIC_KEY_B64 = ' + json.dumps(os.environ.get('ORIENTA_LICENSE_PUBLIC_KEY_B64', '')) + '\\n', encoding='utf-8')" && \
    pyinstaller --onefile --name orienta-pdr run.py \
    --hidden-import uvicorn \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import httptools \
    --hidden-import uvloop \
    --hidden-import websockets \
    --hidden-import watchfiles \
    --hidden-import backend.license \
    --hidden-import backend.license_public_key \
    --hidden-import backend.app \
    --hidden-import backend.engine

FROM debian:bookworm-slim AS run

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PORT=10000 \
    PDR_CORRIDORS_PATH=/app/backend/data/corridors.json

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist/orienta-pdr /app/orienta-pdr
COPY pdr_airchina/backend/data/corridors.json /app/backend/data/corridors.json

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:10000/health >/dev/null 2>&1 || exit 1

CMD ["/app/orienta-pdr"]
