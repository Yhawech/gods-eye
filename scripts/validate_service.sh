#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/opt/gods-eye/current/deploy-config/gods-eye.env"
if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
fi

APP_PORT="${APP_PORT:-4173}"
SERVICE_NAME="${SERVICE_NAME:-gods-eye}"
HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"

python3 - <<PY
import json
import sys
import time
import urllib.request

url = "$HEALTH_URL"
last_error = None

for _ in range(24):
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        database = payload.get("database") or {}
        if payload.get("ok") is True and database.get("connected") is True:
            print("GOD EYE health check passed. MongoDB Atlas is connected.")
            sys.exit(0)
        last_error = database.get("error") or "MongoDB Atlas is not connected."
    except Exception as exc:
        last_error = str(exc)
    time.sleep(5)

print(f"Health check failed: {last_error}", file=sys.stderr)
sys.exit(1)
PY

systemctl status "$SERVICE_NAME" --no-pager || true

if [ -f "/etc/$SERVICE_NAME/$SERVICE_NAME.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "/etc/$SERVICE_NAME/$SERVICE_NAME.env"
  set +a
fi

if [ "$(printf '%s' "${GLOBE_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  GLOBE_HEALTH_URL="http://127.0.0.1:${GLOBE_APP_PORT:-4174}/"
  python3 - <<PY
import sys
import time
import urllib.request

url = "$GLOBE_HEALTH_URL"
last_error = None
for _ in range(18):
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            if 200 <= response.status < 500:
                print("GOD EYE globe companion health check passed.")
                sys.exit(0)
    except Exception as exc:
        last_error = str(exc)
    time.sleep(5)

print(f"Globe health check failed: {last_error}", file=sys.stderr)
sys.exit(1)
PY
  systemctl status "${SERVICE_NAME}-globe" --no-pager || true
fi
