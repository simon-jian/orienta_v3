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

echo "[3/4] writing stack + demo .env (copies SMTP/VAPID/Twilio/FlightAware from apps/dashboard/.env)..."
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

python3 - "$ROOT/apps/dashboard/.env" "$OUT_DIR/stack/.env" "$JWT_SECRET" "$KIOSK_SCAN_SECRET" "$ADMIN_HASH" "$OPS_HASH" <<'PY'
import sys
from pathlib import Path

src_path, dest_path, jwt_secret, kiosk_secret, admin_hash, ops_hash = sys.argv[1:7]

def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, raw = s.split("=", 1)
        val = raw.strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out

def quote(value: str) -> str:
    if value == "":
        return ""
    if all(ch not in value for ch in ' \t#"\'\\$'):
        return value
    return "'" + value.replace("'", "'\"'\"'") + "'"

src = load_env(Path(src_path))

def take(key: str, default: str = "") -> str:
    return (src.get(key) or default).strip()

def portable_upstream(url: str, fallback: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return fallback
    lowered = raw.lower()
    if "127.0.0.1" in lowered or "localhost" in lowered:
        return fallback
    return raw

pdr = portable_upstream(take("PDR_API_ORIGIN"), "")
if pdr == "" and take("PDR_API_ORIGIN"):
    pdr = "http://host.docker.internal:8000"

public = take("PUBLIC_BASE_URL")
low = public.lower()
if (not public) or "localhost" in low or "127.0.0.1" in low or "trycloudflare.com" in low:
    public = ""

mail_from = take("MAIL_FROM") or take("SMTP_USER")
smtp_host = take("SMTP_HOST")
smtp_user = take("SMTP_USER")
smtp_pass = take("SMTP_PASS")
vapid_pub = take("VAPID_PUBLIC_KEY")
vapid_priv = take("VAPID_PRIVATE_KEY")
placeholder = "your_vapid" in vapid_pub.lower() or "your_vapid" in vapid_priv.lower()
if placeholder or len(vapid_pub) < 80 or len(vapid_priv) < 40:
    vapid_pub, vapid_priv = "", ""

lines = [
    "# Demo env packed for a machine with no source tree.",
    "# Admin: admin@airchina.com / orienta123",
    "#        ops@airchina.com / orienta123",
    "# SMTP / VAPID / Twilio / FlightAware copied from the pack machine",
    "# apps/dashboard/.env when present. PUBLIC_BASE_URL is filled on first",
    "# ./load-and-start.sh from this host's LAN IP (tunnels are not portable).",
    "#",
    "# Start the orienta-map bundle on this machine first (port 7801).",
    "",
    "HOST_BIND=0.0.0.0",
    "HOST_PORT=5174",
    "",
    f"JWT_SECRET={quote(jwt_secret)}",
    # Quoted because a scrypt hash contains `$`, and Compose interpolates
    # unquoted env-file values: `scrypt$salt$hash` came out with the hash
    # segment expanded as an unset variable ("... variable is not set.
    # Defaulting to a blank string"), which corrupts the admin password.
    f"ADMIN_CREDENTIALS={quote(f'admin@airchina.com:{admin_hash},ops@airchina.com:{ops_hash}')}",
    f"KIOSK_SCAN_SECRET={quote(kiosk_secret)}",
    f"PAX_ACCOUNT_CREDENTIALS={quote(take('PAX_ACCOUNT_CREDENTIALS'))}",
    "",
    "INDOOR_MAP_UPSTREAM=http://host.docker.internal:7801",
    "INDOOR_MAP_API_UPSTREAM=http://host.docker.internal:7801",
    "VITE_LOCAL_AIRPORT_MAP=0",
    f"PDR_API_ORIGIN={quote(pdr)}",
    "",
    f"FLIGHTAWARE_API_KEY={quote(take('FLIGHTAWARE_API_KEY'))}",
    "ROUTE_SITE_DEFAULT_TENANT=airchina",
    "DEFAULT_AIRPORT=PEK",
    "DEFAULT_TERMINAL=T3E",
    "LOG_LEVEL=info",
    "",
    f"PUBLIC_BASE_URL={quote(public)}",
    f"VAPID_PUBLIC_KEY={quote(vapid_pub)}",
    f"VAPID_PRIVATE_KEY={quote(vapid_priv)}",
    f"VAPID_SUBJECT={quote(take('VAPID_SUBJECT') or 'mailto:ops@orienta.ai')}",
    "",
    f"TWILIO_ACCOUNT_SID={quote(take('TWILIO_ACCOUNT_SID'))}",
    f"TWILIO_AUTH_TOKEN={quote(take('TWILIO_AUTH_TOKEN'))}",
    f"TWILIO_FROM_NUMBER={quote(take('TWILIO_FROM_NUMBER'))}",
    f"SMS_DEFAULT_COUNTRY_CODE={quote(take('SMS_DEFAULT_COUNTRY_CODE'))}",
    "",
    f"SMTP_HOST={quote(smtp_host)}",
    f"SMTP_PORT={quote(take('SMTP_PORT') or '587')}",
    f"SMTP_SECURE={quote(take('SMTP_SECURE') or '0')}",
    f"SMTP_USER={quote(smtp_user)}",
    f"SMTP_PASS={quote(smtp_pass)}",
    f"MAIL_FROM={quote(mail_from)}",
    "",
]
Path(dest_path).write_text("\n".join(lines) + "\n")

def status(ok: bool) -> str:
    return "copied" if ok else "missing"

print(f"  email:  {status(bool(smtp_host and smtp_user and smtp_pass))}", flush=True)
print(f"  push:   {status(bool(vapid_pub and vapid_priv))}", flush=True)
print(f"  sms:    {status(bool(take('TWILIO_ACCOUNT_SID') and take('TWILIO_AUTH_TOKEN') and take('TWILIO_FROM_NUMBER')))}", flush=True)
print(f"  flights:{status(bool(take('FLIGHTAWARE_API_KEY')))}", flush=True)
PY

if [[ ! -f "$ROOT/apps/dashboard/.env" ]]; then
  echo "  WARNING: apps/dashboard/.env not found — bundle has no SMTP/VAPID/flight keys." >&2
fi

# Visible twin of the dotfile: copies that skip hidden files still carry the config.
cp "$OUT_DIR/stack/.env" "$OUT_DIR/stack/env.bundle"
printf '%s %s built %s\n' "$IMAGE" "$PLATFORM" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$OUT_DIR/stack/BUNDLE_VERSION"

cat > "$OUT_DIR/INSTALL.txt" <<EOF
Orienta v3 dashboard — ${TARGET} (${PLATFORM})

Requires Docker Engine or Docker Desktop.
This bundle's stack/.env is a full demo config (email / push / flights
copied from the pack machine). The demo PC does not need this git repo.

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
   First start fills PUBLIC_BASE_URL with this machine's LAN IP so
   invite emails/QR open on a phone on the same network. The script then
   prints which features (email / push / SMS / flights) the container got.

   Copy this folder with 'cp -a' or a tar archive: stack/.env is a hidden
   file. If it is lost, stack/env.bundle holds the same values and the
   start script restores it automatically.

4. Open:
     http://localhost:5174
     http://localhost:5174/pax
   Admin: admin@airchina.com / orienta123

5. Stop:
     cd stack && docker compose --env-file .env down
EOF

echo "[4/4] bundle ready: $OUT_DIR"
ls -lh "$OUT_DIR" "$OUT_DIR/stack"
