#!/usr/bin/env bash
# Start the offline dashboard bundle (image must already be loaded).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env next to this script. Copy it from the bundle or re-run package-bundle.sh." >&2
  exit 1
fi

if ! docker image inspect orienta-v3-dashboard:latest >/dev/null 2>&1; then
  echo "Image orienta-v3-dashboard:latest not found." >&2
  echo "From the bundle directory:  docker load -i orienta-v3-dashboard-images.tar" >&2
  exit 1
fi

docker compose --env-file .env up -d

echo ""
echo "Dashboard:  http://127.0.0.1:5174"
echo "Passenger:  http://127.0.0.1:5174/pax"
echo "Health:     curl -s http://127.0.0.1:5174/health"
echo ""
echo "Indoor map must already be running on this machine at :7801"
echo "(orienta-indoor-map bundle). Admin login is in .env comments."
