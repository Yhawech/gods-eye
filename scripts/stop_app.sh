#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-gods-eye}"

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}-globe.service"; then
  systemctl stop "${SERVICE_NAME}-globe" || true
fi

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  systemctl stop "$SERVICE_NAME" || true
fi
