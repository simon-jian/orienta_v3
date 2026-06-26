# Build from orienta_v3 repo root:
#   docker compose build orienta
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./
RUN npm ci
COPY apps/dashboard/ ./
RUN npm run build && npm run build:server

FROM node:20-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=5174
ENV DB_PATH=/app/data/passengers.db
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public
RUN mkdir -p /app/data
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5174/pdr-api/health >/dev/null 2>&1 || wget -qO- http://127.0.0.1:5174/ >/dev/null 2>&1 || exit 1
CMD ["node", "dist-server/server/server.js"]
