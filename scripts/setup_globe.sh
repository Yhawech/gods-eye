#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gods-eye}"
SERVICE_NAME="${SERVICE_NAME:-gods-eye}"
GLOBE_ENABLED="${GLOBE_ENABLED:-false}"
GLOBE_REPO_URL="${GLOBE_REPO_URL:-https://github.com/bilawalsidhu/gods-eye-view.git}"
GLOBE_INSTALL_DIR="${GLOBE_INSTALL_DIR:-/opt/gods-eye/globe}"
GLOBE_APP_HOST="${GLOBE_APP_HOST:-0.0.0.0}"
GLOBE_APP_PORT="${GLOBE_APP_PORT:-4174}"
RUN_USER="${RUN_USER:-ubuntu}"
GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-}"
FIRMS_MAP_KEY="${FIRMS_MAP_KEY:-}"
AISSTREAM_API_KEY="${AISSTREAM_API_KEY:-}"
CCTV_MAX_SOURCES="${CCTV_MAX_SOURCES:-900}"
CCTV_AUSTIN_MAX_SOURCES="${CCTV_AUSTIN_MAX_SOURCES:-120}"
CCTV_PREFER_AUSTIN="${CCTV_PREFER_AUSTIN:-0}"
GLOBE_OSINT_ENABLED="${GLOBE_OSINT_ENABLED:-true}"
GLOBE_OSINT_REFRESH_MS="${GLOBE_OSINT_REFRESH_MS:-300000}"
GLOBE_OSINT_MAX_ITEMS="${GLOBE_OSINT_MAX_ITEMS:-80}"

normalize_bool() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

if [ "$(normalize_bool "$GLOBE_ENABLED")" != "true" ]; then
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}-globe.service"; then
    systemctl disable --now "${SERVICE_NAME}-globe" || true
  fi
  exit 0
fi

if [ -z "$GOOGLE_MAPS_API_KEY" ]; then
  echo "GLOBE_ENABLED=true but GOOGLE_MAPS_API_KEY is empty." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required for the globe companion." >&2
  exit 1
fi

mkdir -p "$(dirname "$GLOBE_INSTALL_DIR")"
# Pin the globe to the exact upstream revision the GOD EYE customizations were
# built against (314a0e1, 2026-08-27). Newer upstream adds features we removed
# and can break the patch chain, so never float to the default branch.
GLOBE_REPO_REF="${GLOBE_REPO_REF:-314a0e1c2ef668cb110674b737e19a44ff6fc1ef}"
if [ ! -d "$GLOBE_INSTALL_DIR/.git" ]; then
  git clone "$GLOBE_REPO_URL" "$GLOBE_INSTALL_DIR"
fi
export HOME="${HOME:-/root}"
git config --global --add safe.directory "$GLOBE_INSTALL_DIR" 2>/dev/null || true
G() { git -c safe.directory="$GLOBE_INSTALL_DIR" -C "$GLOBE_INSTALL_DIR" "$@"; }
G fetch origin || true
G checkout --detach "$GLOBE_REPO_REF" || G checkout --detach origin/HEAD
G reset --hard "$GLOBE_REPO_REF" 2>/dev/null || true

cat > "$GLOBE_INSTALL_DIR/.env" <<EOF
GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY
PORT=$GLOBE_APP_PORT
HOST=$GLOBE_APP_HOST
OPENSKY_AUTH_MODE=anon
VITE_AIS_LIVE_API_URL=/api/ais-live
VITE_AIS_LIVE_MAX_ROWS=12000
VITE_AIS_LIVE_LABEL_MAX_ROWS=900
GEV_RATELIMIT_GOOGLE_PER_MIN=30
FIRMS_MAP_KEY=$FIRMS_MAP_KEY
AISSTREAM_API_KEY=$AISSTREAM_API_KEY
CCTV_MAX_SOURCES=$CCTV_MAX_SOURCES
CCTV_AUSTIN_MAX_SOURCES=$CCTV_AUSTIN_MAX_SOURCES
CCTV_PREFER_AUSTIN=$CCTV_PREFER_AUSTIN
GLOBE_OSINT_ENABLED=$GLOBE_OSINT_ENABLED
GLOBE_OSINT_REFRESH_MS=$GLOBE_OSINT_REFRESH_MS
GLOBE_OSINT_MAX_ITEMS=$GLOBE_OSINT_MAX_ITEMS
GEV_ALLOWED_HOSTS=${GLOBE_ALLOWED_HOSTS:-globe.godseyes.in}
VITE_GLOBE_OSINT_ENABLED=$GLOBE_OSINT_ENABLED
OPENAI_API_KEY=
EOF

cd "$APP_DIR/current"
node scripts/patch_globe_layout.mjs "$GLOBE_INSTALL_DIR"

npm --prefix "$GLOBE_INSTALL_DIR" install --engine-strict=false
chown -R "$RUN_USER:$RUN_USER" "$GLOBE_INSTALL_DIR"

cat > "/etc/systemd/system/${SERVICE_NAME}-globe.service" <<SERVICE
[Unit]
Description=GOD EYE 3D Globe Companion
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$GLOBE_INSTALL_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run dev -- --host $GLOBE_APP_HOST --port $GLOBE_APP_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}-globe"
systemctl restart "${SERVICE_NAME}-globe"

# --- IPv4 pinning for feeds Node cannot reach over this VPC's dead IPv6 route ---
# Node >=17 dns.lookup returns records in raw DNS order (gai.conf is ignored) and
# undici dials the AAAA address first; EC2 VPCs have no IPv6 egress, so NASA FIRMS
# (dual-stack) times out ("fetch failed") while curl works. Pinning the NASA host
# to IPv4 in /etc/hosts makes every process dial IPv4 (verified: FIRMS 502 -> 200
# with 108k fires, 2026-11-11). Idempotent.
grep -q 'firms.modaps.eosdis.nasa.gov' /etc/hosts || echo '198.118.194.34 firms.modaps.eosdis.nasa.gov' >> /etc/hosts
# Belt-and-braces for any getaddrinfo consumers: prefer IPv4 system-wide.
grep -E '^precedence ::ffff' /etc/gai.conf 2>/dev/null || echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf

# The hosts/gai changes take effect for the globe after one restart.
systemctl restart "${SERVICE_NAME}-globe"
