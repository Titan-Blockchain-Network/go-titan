#!/usr/bin/env bash
#
# Installs build/titan and build/avalanchego to /usr/local/bin.
# Stops running Titan systemd units first so copies are not "Text file busy".
#
# Usage (from avalanchego/):
#   ./scripts/build-titan.sh --install
#   ./scripts/install-titan-binaries.sh
#   ./scripts/install-titan-binaries.sh --restart titan-node titan-node-origin
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="${TITAN_BIN_DIR:-/usr/local/bin}"
RESTART=false
SERVICES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart)
      RESTART=true
      shift
      ;;
    --service|-s)
      SERVICES+=("$2")
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--restart] [--service NAME]..."
      echo "  Stops listed systemd units (default: titan-node, titan-node-origin if active),"
      echo "  installs build binaries to ${BIN_DIR}, optionally restarts services."
      exit 0
      ;;
    *)
      SERVICES+=("$1")
      shift
      ;;
  esac
done

if [[ ${#SERVICES[@]} -eq 0 ]]; then
  for svc in titan-node titan-node-origin; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      SERVICES+=("$svc")
    fi
  done
fi

run_priv() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

for svc in "${SERVICES[@]}"; do
  if systemctl is-active --quiet "$svc" 2>/dev/null || systemctl is-enabled --quiet "$svc" 2>/dev/null; then
    echo "Stopping ${svc}..."
    run_priv systemctl stop "$svc" || true
  fi
done

if [[ ${#SERVICES[@]} -gt 0 ]]; then
  sleep 2
fi

for pair in "avalanchego:avalanchego" "titan:titan"; do
  src_name="${pair%%:*}"
  dst_name="${pair##*:}"
  src="${AVAGO_DIR}/build/${src_name}"
  dst="${BIN_DIR}/${dst_name}"
  if [[ ! -f "$src" ]]; then
    echo "Missing ${src}. Run ./scripts/build-titan.sh first." >&2
    exit 1
  fi
  echo "Installing ${src} → ${dst}"
  run_priv install -m 755 "$src" "$dst"
done

if $RESTART; then
  for svc in "${SERVICES[@]}"; do
    echo "Starting ${svc}..."
    run_priv systemctl start "$svc" || true
  done
fi

echo "Binaries installed to ${BIN_DIR}. CLI: titan   Node: ${BIN_DIR}/avalanchego"