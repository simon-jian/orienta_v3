#!/usr/bin/env bash
# Dev-only: expose the local passenger dashboard over HTTPS via a Cloudflare
# quick tunnel (*.trycloudflare.com) so you can test PWA / Web Push on iPhone.
#
# This is a temporary testing aid — not a production deploy. The URL changes
# every run.
#
# Prerequisites (run in separate terminals, or pass --start-local):
#   cd apps/dashboard && npm run dev:server   # Express, default :5175
#   cd apps/dashboard && npm run dev          # Vite, default :5173
#   Indoor map reachable from this machine (INDOOR_MAP_UPSTREAM in .env)
#
# Usage:
#   ./scripts/start_pax_trycloudflare.sh              # tunnel existing :5173
#   ./scripts/start_pax_trycloudflare.sh --start-local # also start vite+server
#   ./scripts/start_pax_trycloudflare.sh --stop        # tear down tunnel (+local)
#   VITE_PORT=5173 ./scripts/start_pax_trycloudflare.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_DIR="$REPO_DIR/apps/dashboard"
LOG_DIR="${TMPDIR:-/tmp}/orienta_pax_tunnel"
mkdir -p "$LOG_DIR"

VITE_PORT="${VITE_PORT:-5173}"
SERVER_PORT="${SERVER_PORT:-5175}"
TUNNEL_LOG="$LOG_DIR/cloudflared_vite.log"
URL_FILE="$LOG_DIR/public_url.txt"
PID_FILE="$LOG_DIR/cloudflared.pid"
VITE_PID_FILE="$LOG_DIR/vite.pid"
SERVER_PID_FILE="$LOG_DIR/server.pid"
START_LOCAL=0
DO_STOP=0

for arg in "$@"; do
  case "$arg" in
    --start-local) START_LOCAL=1 ;;
    --stop) DO_STOP=1 ;;
    -h|--help)
      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

stop_all() {
  echo "==> Stopping trycloudflare tunnel (and any locals started by this script)..."
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${VITE_PORT}" 2>/dev/null || true
  if [[ -f "$VITE_PID_FILE" ]]; then
    kill "$(cat "$VITE_PID_FILE")" 2>/dev/null || true
    rm -f "$VITE_PID_FILE"
  fi
  if [[ -f "$SERVER_PID_FILE" ]]; then
    kill "$(cat "$SERVER_PID_FILE")" 2>/dev/null || true
    rm -f "$SERVER_PID_FILE"
  fi
  rm -f "$URL_FILE"
  echo "    done."
}

if [[ "$DO_STOP" -eq 1 ]]; then
  stop_all
  exit 0
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared not found. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi

wait_for_http() {
  local url="$1"
  local label="$2"
  local tries="${3:-40}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 0.5
  done
  echo "ERROR: timed out waiting for $label ($url)" >&2
  return 1
}

wait_for_tunnel_url() {
  local log_file="$1"
  for _ in $(seq 1 45); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log_file" 2>/dev/null | head -1 || true)"
    if [[ -n "${url:-}" ]]; then
      echo "$url"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: timed out waiting for trycloudflare URL (see $log_file)" >&2
  return 1
}

port_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"
  else
    curl -sf -o /dev/null "http://127.0.0.1:$port/" || return 1
  fi
}

if [[ "$START_LOCAL" -eq 1 ]]; then
  if [[ ! -f "$DASHBOARD_DIR/.env" ]]; then
    echo "ERROR: missing $DASHBOARD_DIR/.env (copy from .env.example and fill secrets)." >&2
    exit 1
  fi
  if ! port_listening "$SERVER_PORT"; then
    echo "==> Starting Express backend on :$SERVER_PORT..."
    (
      cd "$DASHBOARD_DIR"
      npm run build:server >/dev/null
      # Prefer SERVER_PORT over .env PORT for predictable tunnel wiring.
      PORT="$SERVER_PORT" node --env-file=.env dist-server/server/server.js
    ) >"$LOG_DIR/server.log" 2>&1 &
    echo $! >"$SERVER_PID_FILE"
    wait_for_http "http://127.0.0.1:${SERVER_PORT}/livez" "Express /livez" 60
  else
    echo "==> Express already listening on :$SERVER_PORT"
  fi

  if ! port_listening "$VITE_PORT"; then
    echo "==> Starting Vite on :$VITE_PORT..."
    (
      cd "$DASHBOARD_DIR"
      npx vite --port "$VITE_PORT" --host 127.0.0.1
    ) >"$LOG_DIR/vite.log" 2>&1 &
    echo $! >"$VITE_PID_FILE"
    wait_for_http "http://127.0.0.1:${VITE_PORT}/" "Vite" 60
  else
    echo "==> Vite already listening on :$VITE_PORT"
  fi
else
  if ! port_listening "$VITE_PORT"; then
    echo "ERROR: nothing listening on 127.0.0.1:$VITE_PORT." >&2
    echo "Start the dashboard first:" >&2
    echo "  cd apps/dashboard && npm run dev:server   # terminal 1 (:5175)" >&2
    echo "  cd apps/dashboard && npm run dev          # terminal 2 (:5173)" >&2
    echo "Or re-run with --start-local." >&2
    exit 1
  fi
fi

echo "==> Stopping any previous tunnel for :$VITE_PORT..."
pkill -f "cloudflared tunnel --url http://127.0.0.1:${VITE_PORT}" 2>/dev/null || true
rm -f "$PID_FILE" "$URL_FILE" "$TUNNEL_LOG"
sleep 0.5

echo "==> Opening Cloudflare quick tunnel → http://127.0.0.1:${VITE_PORT} ..."
nohup cloudflared tunnel --url "http://127.0.0.1:${VITE_PORT}" >"$TUNNEL_LOG" 2>&1 &
echo $! >"$PID_FILE"
disown || true

PUBLIC_URL="$(wait_for_tunnel_url "$TUNNEL_LOG")"
echo "$PUBLIC_URL" >"$URL_FILE"

cat <<EOF

================================================================
  Phone (HTTPS / PWA test)
  Open:     ${PUBLIC_URL}/pax
  Login:    ${PUBLIC_URL}/pax/login

  iPhone Web Push:
    Safari → share → Add to Home Screen → open from icon
    (standalone required; plain Safari tab often cannot push)

  Logs:     $TUNNEL_LOG
  Stop:     $REPO_DIR/scripts/start_pax_trycloudflare.sh --stop

  Notes:
  - URL is temporary and changes every run (dev only).
  - Vite proxies /api + /indoor-map to Express; keep Express up.
  - Map must be reachable FROM THIS MACHINE via INDOOR_MAP_UPSTREAM
    in apps/dashboard/.env (phone never talks to the LAN IP directly).
  - If Push subscribe fails, set real VAPID_* in .env and restart Express.
================================================================
EOF
