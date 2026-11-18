#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gods-eye}"
SERVICE_NAME="${SERVICE_NAME:-gods-eye}"

install_node_apt() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "${major:-0}" -ge 24 ]; then
      return 0
    fi
  fi
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
}

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git unzip awscli python3 python3-venv python3-pip
  install_node_apt
  apt-get install -y nodejs
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y python3 python3-pip curl unzip awscli git nodejs npm
elif command -v yum >/dev/null 2>&1; then
  yum install -y python3 python3-pip curl unzip awscli git nodejs npm
else
  echo "Unsupported Linux package manager. Use Ubuntu, Amazon Linux, RHEL, or compatible." >&2
  exit 1
fi

mkdir -p "$APP_DIR/current" "$APP_DIR/shared" "/etc/$SERVICE_NAME"

if ! id ubuntu >/dev/null 2>&1 && ! id ec2-user >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin gods-eye || true
fi
