#!/usr/bin/env bash
# Build offline dashboard bundles for Ubuntu 24.04 (amd64) and MacBook Pro (arm64).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/package-bundle.sh" linux/amd64
"$DIR/package-bundle.sh" linux/arm64
echo ""
echo "Dashboard bundles (pair with orienta-map, not orienta-indoor-map):"
echo "  Ubuntu 24.04: $DIR/dist/ubuntu-24.04/orienta-v3-dashboard-bundle"
echo "                + /home/simon/orienta-map/docker/dist/orienta-map-bundle-amd64"
echo "  MacBook Pro:  $DIR/dist/macbook-pro/orienta-v3-dashboard-bundle"
echo "                + /home/simon/orienta-map/docker/dist/orienta-map-bundle-arm64"
