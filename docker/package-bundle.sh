#!/usr/bin/env bash
# Build the v3 dashboard image and pack an offline folder for another machine.
# Run from anywhere:
#   ./docker/package-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-$ROOT/docker/dist/orienta-v3-dashboard-bundle}"
mkdir -p "$OUT_DIR/stack"

echo "[1/4] docker compose build orienta..."
# Root compose interpolates :? required env even for `build`. These values
# are not baked into the image — runtime secrets come from stack/.env.
JWT_SECRET="build-placeholder-not-used-at-runtime-32ch" \
ADMIN_CREDENTIALS="admin@build.local:unused" \
KIOSK_SCAN_SECRET="build-placeholder" \
docker compose build orienta

echo "[2/4] saving image..."
docker save -o "$OUT_DIR/orienta-v3-dashboard-images.tar" orienta-v3-dashboard:latest

echo "[3/4] writing stack + demo .env..."
cp "$ROOT/docker/docker-compose.yml" "$OUT_DIR/stack/docker-compose.yml"
cp "$ROOT/docker/load-and-start.sh" "$OUT_DIR/stack/load-and-start.sh"
chmod +x "$OUT_DIR/stack/load-and-start.sh"

# Production boot requires scrypt-hashed admin passwords (plaintext is refused).
hash_pw() {
  node -e '
    const { randomBytes, scryptSync } = require("crypto");
    const salt = randomBytes(16);
    const hash = scryptSync(process.argv[1], salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    process.stdout.write("scrypt$" + salt.toString("hex") + "$" + hash.toString("hex"));
  ' "$1"
}

JWT_SECRET="$(openssl rand -hex 32)"
KIOSK_SCAN_SECRET="$(openssl rand -hex 24)"
ADMIN_HASH="$(hash_pw orienta123)"
OPS_HASH="$(hash_pw orienta123)"

cat > "$OUT_DIR/stack/.env" <<EOF
# Demo env for the Mac / offline bundle. NODE_ENV=production in compose.
# Admin login (same password for both):
#   admin@airchina.com / orienta123
#   ops@airchina.com / orienta123
#
# Map: start the indoor-map bundle first (port 7801). Both upstreams go to
# 7801 because that stack's nginx proxies /api to the POI service.

HOST_BIND=0.0.0.0
HOST_PORT=5174

JWT_SECRET=${JWT_SECRET}
ADMIN_CREDENTIALS=admin@airchina.com:${ADMIN_HASH},ops@airchina.com:${OPS_HASH}
KIOSK_SCAN_SECRET=${KIOSK_SCAN_SECRET}

# Same-machine map Docker (not 127.0.0.1 — that is this container).
INDOOR_MAP_UPSTREAM=http://host.docker.internal:7801
INDOOR_MAP_API_UPSTREAM=http://host.docker.internal:7801
VITE_LOCAL_AIRPORT_MAP=0
PDR_API_ORIGIN=

FLIGHTAWARE_API_KEY=
ROUTE_SITE_DEFAULT_TENANT=airchina
DEFAULT_AIRPORT=PEK
DEFAULT_TERMINAL=T3E
LOG_LEVEL=info
EOF

cat > "$OUT_DIR/INSTALL.txt" <<'EOF'
Orienta v3 dashboard — offline Docker bundle

This image is linux/amd64 (built on the Linux workstation).
Intel Mac: run as-is. Apple Silicon: Docker Desktop can emulate amd64;
for native speed, rebuild on the Mac from the git repo instead.

On the Mac (Docker Desktop installed):

1. Start the indoor-map bundle first, confirm:
     http://localhost:7801/airport-map.html
     http://localhost:7801/health

2. Load this dashboard image:
     docker load -i orienta-v3-dashboard-images.tar

3. Start:
     cd stack
     ./load-and-start.sh

4. Open:
     http://localhost:5174
     http://localhost:5174/pax

   Admin: admin@airchina.com / orienta123

5. Stop:
     cd stack && docker compose --env-file .env down
EOF

echo "[4/4] bundle ready: $OUT_DIR"
ls -lh "$OUT_DIR" "$OUT_DIR/stack"
