#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/opt/gods-eye/current/deploy-config/gods-eye.env"
if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
fi

AWS_REGION="${AWS_REGION:-ap-south-1}"
APP_SECRET_ID="${APP_SECRET_ID:-/gods-eye/prod/app-env}"
APP_DIR="${APP_DIR:-/opt/gods-eye}"
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-4173}"
SERVICE_NAME="${SERVICE_NAME:-gods-eye}"
RUN_USER="${RUN_USER:-ubuntu}"

if ! id "$RUN_USER" >/dev/null 2>&1; then
  if id ec2-user >/dev/null 2>&1; then
    RUN_USER="ec2-user"
  else
    RUN_USER="gods-eye"
  fi
fi

ENV_DIR="/etc/$SERVICE_NAME"
ENV_FILE="$ENV_DIR/$SERVICE_NAME.env"
mkdir -p "$ENV_DIR"

SECRET_JSON="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$APP_SECRET_ID" \
  --query SecretString \
  --output text)"

SECRET_JSON="$SECRET_JSON" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json
import os
import shlex

secret = json.loads(os.environ["SECRET_JSON"])
env_file = os.environ["ENV_FILE"]

defaults = {
    "PYTHONUNBUFFERED": "1",
    "MONGODB_DB": "gods_eye",
    "MONGODB_TIMEOUT_MS": "5000",
    "DEEPSEEK_MODEL": "deepseek-v4-flash",
    "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
    "DEEPSEEK_THINKING": "disabled",
    "DEEPSEEK_REASONING_EFFORT": "high",
    "GOOGLE_MAPS_API_KEY": "",
    "GLOBE_ENABLED": "false",
    "GLOBE_REPO_URL": "https://github.com/bilawalsidhu/gods-eye-view.git",
    "GLOBE_INSTALL_DIR": "/opt/gods-eye/globe",
    "GLOBE_APP_HOST": "0.0.0.0",
    "GLOBE_APP_PORT": "4174",
    "GLOBE_VIEW_URL": "",
    "GLOBE_OSINT_ENABLED": "true",
    "GLOBE_OSINT_REFRESH_MS": "300000",
    "GLOBE_OSINT_MAX_ITEMS": "80",
    "ABUSEIPDB_API_KEY": "",
    "VIRUSTOTAL_API_KEY": "",
    "OTX_API_KEY": "",
    "FIRMS_MAP_KEY": "",
    "AISSTREAM_API_KEY": "",
}
values = {**defaults, **{key: str(value or "") for key, value in secret.items()}}

required = ["MONGODB_URI", "DEEPSEEK_API_KEY"]
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit(f"Missing required secret value(s): {', '.join(missing)}")

with open(env_file, "w", encoding="utf-8") as handle:
    for key, value in values.items():
        handle.write(f"{key}={shlex.quote(value)}\n")
PY

chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

python3 -m venv "$APP_DIR/shared/venv"
"$APP_DIR/shared/venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/shared/venv/bin/python" -m pip install -r "$APP_DIR/current/requirements.txt"

chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

cat > "/etc/systemd/system/$SERVICE_NAME.service" <<SERVICE
[Unit]
Description=GOD EYE OSINT FastAPI App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/shared/venv/bin/python -m uvicorn backend.main:app --host $APP_HOST --port $APP_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
"$APP_DIR/current/scripts/setup_globe.sh"
