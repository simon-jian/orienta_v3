# Build from orienta_v3 repo root:
#   docker compose build orienta
FROM node:20-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 has a native addon. `npm ci` prefers a prebuilt binary for
# this platform, but falls back to compiling from source (node-gyp) whenever
# the prebuilt download is unavailable — e.g. a restrictive build-network
# policy that allows the npm registry but not GitHub Releases/CDN. Installing
# build tools here makes the build succeed either way; they never reach the
# run stage below (only the compiled node_modules is copied out).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./
RUN npm ci
COPY apps/dashboard/ ./
RUN npm run build && npm run build:server
# Drop devDependencies (typescript, vite, vitest, ...) but keep the already-
# compiled native bindings for production deps (better-sqlite3) — cheaper and
# more reliable than re-installing from scratch in the run stage.
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS run
WORKDIR /app

# ffmpeg + python3: needed for the single-machine (no REDIS_URL) video-merge
# fallback, which spawns scripts/concat_pek_video_from_csv.py directly from
# the web process (server/services/videoMerge.ts runLocal). Deployments that
# run the `scale` Compose profile do the same work in a separate worker
# container instead, but this image must still support the single-container
# default described in the README.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ffmpeg python3 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5174
ENV DB_PATH=/app/data/passengers.db

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Server-side source of truth for route-site video/CSV assets (distinct from
# dist/route_site, which is the browser-facing copy Vite already produced).
COPY apps/dashboard/public ./public
# Airport/tenant YAML (server/config/loadConfig.ts reads ./config by default
# via AIRPORT_CONFIG_DIR) — without this the server boots with zero airports.
COPY apps/dashboard/config ./config
# server/paths.ts resolves this two levels above the app root (repo-root
# scripts/), matching the layout outside Docker.
COPY scripts /scripts

RUN mkdir -p /app/data \
    && groupadd --system --gid 1001 orienta \
    && useradd --system --uid 1001 --gid orienta --home-dir /app --no-create-home --shell /usr/sbin/nologin orienta \
    && chown -R orienta:orienta /app /scripts

USER orienta

EXPOSE 5174
# /livez (not /health or /readyz): liveness only — is the process itself
# responsive, with no dependency I/O. A container-level healthcheck like this
# is what an orchestrator would use to decide whether to restart the
# container, and a slow/unreachable DB or Redis is not a good reason to kill
# an otherwise-healthy process (that just drops every in-flight WS connection
# too). Use GET /readyz for dependency-aware monitoring instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5174/livez >/dev/null 2>&1 || exit 1
CMD ["node", "dist-server/server/server.js"]
