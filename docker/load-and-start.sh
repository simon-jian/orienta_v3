#!/usr/bin/env bash
# Start the offline dashboard bundle (image must already be loaded).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# `.env` is a dotfile, so a drag-and-drop / `cp stack/*` copy silently drops it
# and the demo machine would boot with no email, push or flight config. The
# packer therefore also ships the same content as a visible `env.bundle`.
if [[ ! -f .env && -f env.bundle ]]; then
  cp env.bundle .env
  echo "Restored .env from env.bundle (the hidden .env was missing)."
fi

if [[ ! -f .env ]]; then
  echo "Missing .env next to this script. Copy it from the bundle or re-run package-bundle.sh." >&2
  exit 1
fi

if [[ -f BUNDLE_VERSION ]]; then
  echo "Bundle: $(cat BUNDLE_VERSION)"
fi

if ! docker image inspect orienta-v3-dashboard:latest >/dev/null 2>&1; then
  echo "Image orienta-v3-dashboard:latest not found." >&2
  echo "From the bundle directory:  docker load -i orienta-v3-dashboard-images.tar" >&2
  exit 1
fi

# Demo machines have no source tree. If PUBLIC_BASE_URL was left empty at
# pack time (tunnels / localhost are not portable), pin it to this host's
# LAN address so invite emails and QR codes open on a phone on the same Wi-Fi.
if ! grep -qE '^PUBLIC_BASE_URL=https?://' .env; then
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  host_port="$(awk -F= '/^HOST_PORT=/{print $2; exit}' .env)"
  host_port="${host_port:-5174}"
  if [[ -n "$host_ip" ]]; then
    if grep -qE '^PUBLIC_BASE_URL=' .env; then
      sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://${host_ip}:${host_port}|" .env
    else
      printf '\nPUBLIC_BASE_URL=http://%s:%s\n' "$host_ip" "$host_port" >> .env
    fi
    echo "PUBLIC_BASE_URL=http://${host_ip}:${host_port}"
  fi
fi

docker compose --env-file .env up -d

# Report what the container actually received, so a stale or stripped .env is
# visible here instead of only as "未配置 / not configured" in the invites UI.
cfg="$(docker compose --env-file .env config 2>/dev/null || true)"
feature() {
  local label="$1"; shift
  local var
  for var in "$@"; do
    if ! printf '%s\n' "$cfg" | grep -qE "^[[:space:]]*${var}:[[:space:]]*[\"']?[^\"'[:space:]]"; then
      echo "  ${label}: NOT configured (missing ${var})"
      return
    fi
  done
  echo "  ${label}: configured"
}

echo ""
echo "Runtime config seen by the container:"
feature "Email (SMTP)" SMTP_HOST SMTP_USER SMTP_PASS
feature "Web Push (VAPID)" VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
feature "SMS (Twilio)" TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER
feature "Flight data" FLIGHTAWARE_API_KEY
feature "Public link base" PUBLIC_BASE_URL

echo ""
echo "Dashboard:  http://127.0.0.1:5174"
echo "Passenger:  http://127.0.0.1:5174/pax"
echo "Health:     curl -s http://127.0.0.1:5174/health"
echo ""
echo "Indoor map must already be running on this machine at :7801"
echo "(orienta-map bundle). Admin login is in .env comments."
