#!/usr/bin/env bash
#
# Wipes a Titan node install on this host so you can re-run titan-server-bootstrap.sh
# from a fresh git clone. Does NOT delete /root/master.key unless you pass --all-keys.
#
# Usage:
#   sudo ./scripts/wipe-titan-server.sh
#   sudo ./scripts/wipe-titan-server.sh --purge-repo   # also removes ~/go-titan checkout
#
set -euo pipefail

PURGE_REPO=false
PURGE_MASTER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-repo) PURGE_REPO=true; shift ;;
    --all-keys) PURGE_MASTER=true; shift ;;
    --help|-h)
      echo "Usage: sudo $0 [--purge-repo] [--all-keys]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

echo "=== Stopping Titan services ==="
for svc in $(systemctl list-units --type=service --all 'titan*' --no-legend 2>/dev/null | awk '{print $1}'); do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done
# Common names if list-units misses them
for svc in titan-node titan-node-origin; do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
  rm -f "/etc/systemd/system/${svc}.service"
done
systemctl daemon-reload

echo "=== Removing node data and keys ==="
rm -rf /root/titan-data /root/keys /root/titan-genesis-backup
if $PURGE_MASTER; then
  rm -f /root/master.key
  echo "  Removed /root/master.key"
else
  echo "  Kept /root/master.key (treasury) — use --all-keys to remove"
fi

if $PURGE_REPO; then
  echo "=== Removing go-titan checkout ==="
  rm -rf /root/go-titan
fi

echo "=== Done ==="
echo "Next: git clone https://github.com/Titan-Blockchain-Network/go-titan.git && cd go-titan"
echo "       ./avalanchego/scripts/titan-server-bootstrap.sh"