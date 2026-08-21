#!/usr/bin/env bash
# Build one dashboard image and pack an offline folder.
#
#   ./docker/package-bundle.sh                 # this machine's arch
#   ./docker/package-bundle.sh linux/amd64     # Ubuntu 24.04 / Intel
#   ./docker/package-bundle.sh linux/arm64     # Apple Silicon MacBook Pro
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

host_platform() {
  case "$(uname -m)" in
    x86_64|amd64) echo linux/amd64 ;;
    aarch64|arm64) echo linux/arm64 ;;
    *) echo "unsupported host arch: $(uname -m)" >&2; exit 1 ;;
  esac
}

PLATFORM="${1:-$(host_platform)}"
case "$PLATFORM" in
  linux/amd64) ARCH=amd64; TARGET=ubuntu-24.04 ;;
  linux/arm64) ARCH=arm64; TARGET=macbook-pro ;;
  *) echo "usage: $0 [linux/amd64|linux/arm64]" >&2; exit 1 ;;
esac

IMAGE="orienta-v3-dashboard:${ARCH}"
OUT_DIR="${2:-$ROOT/docker/dist/${TARGET}/orienta-v3-dashboard-bundle}"
mkdir -p "$OUT_DIR/stack"

echo "[1/4] building ${IMAGE} (${PLATFORM})..."
docker buildx build \
  --platform "$PLATFORM" \
  --file apps/dashboard/Dockerfile \
  --tag "$IMAGE" \
  --tag orienta-v3-dashboard:latest \
  --load \
  .

echo "[2/4] saving image..."
docker save -o "$OUT_DIR/orienta-v3-dashboard-images.tar" "$IMAGE"

echo "[3/4] writing stack + demo .env..."
sed "s|image: orienta-v3-dashboard:latest|image: ${IMAGE}|" \
  "$ROOT/docker/docker-compose.yml" > "$OUT_DIR/stack/docker-compose.yml"
sed "s|orienta-v3-dashboard:latest|${IMAGE}|g" \
  "$ROOT/docker/load-and-start.sh" > "$OUT_DIR/stack/load-and-start.sh"
chmod +x "$OUT_DIR/stack/load-and-start.sh"

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
# Demo env. NODE_ENV=production in compose.
# Admin: admin@airchina.com / orienta123
#        ops@airchina.com / orienta123
#
# Start the orienta-map bundle on this machine first (port 7801).

HOST_BIND=0.0.0.0
HOST_PORT=5174

JWT_SECRET=${JWT_SECRET}
ADMIN_CREDENTIALS=admin@airchina.com:${ADMIN_HASH},ops@airchina.com:${OPS_HASH}
KIOSK_SCAN_SECRET=${KIOSK_SCAN_SECRET}

INDOOR_MAP_UPSTREAM=http://host.docker.internal:7801
INDOOR_MAP_API_UPSTREAM=http://host.docker.internal:7801
VITE_LOCAL_AIRPORT_MAP=0
PDR_API_ORIGIN=

FLIGHTAWARE_API_KEY=
ROUTE_SITE_DEFAULT_TENANT=airchina
DEFAULT_AIRPORT=PEK
DEFAULT_TERMINAL=T3E
LOG_LEVEL=info

# Public origin for claim links / SMS. Set this to a phone-reachable URL
# (Cloudflare tunnel or real domain) before texting passengers.
PUBLIC_BASE_URL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
SMS_DEFAULT_COUNTRY_CODE=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
EOF

cat > "$OUT_DIR/INSTALL.txt" <<EOF
Orienta v3 dashboard — ${TARGET} (${PLATFORM})

Requires Docker Engine or Docker Desktop.

1. Start the matching orienta-map bundle first
   (from orienta-map/docker/dist/orienta-map-bundle-arm64 or -amd64,
    not orienta-indoor-map):
     docker load -i images.tar
     cd stack && ./start.sh
     http://localhost:7801/airport-map.html
     http://localhost:7801/health

2. Load this image:
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
