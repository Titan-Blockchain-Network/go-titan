#!/usr/bin/env bash
#
# install.sh - One-liner friendly installer/bootstrap for Titan blockchain node.
#
# Usage (on fresh Ubuntu server):
#   curl -sSL https://raw.githubusercontent.com/YOURORG/go-titan/main/install.sh | bash
#
# This is the smoothest entry point. It ensures basic tools, clones, then
# runs the full interactive bootstrap (apt update, Go, build, firewall apply,
# systemd, healthcheck that verifies you are a validator).

set -euo pipefail

REPO="${REPO:-https://github.com/your-org/go-titan.git}"
TARGET_DIR="${TARGET_DIR:-go-titan}"

echo "=== Titan one-liner installer ==="
echo "Preparing fresh server for Titan node..."

# Minimal bootstrap deps (no sudo yet if possible)
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Installing minimal tools (git, curl)..."
  if command -v apt-get >/dev/null; then
    sudo apt-get update -y >/dev/null 2>&1 || true
    sudo apt-get install -y git curl ca-certificates >/dev/null 2>&1 || true
  fi
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Cloning $REPO into ./$TARGET_DIR ..."
  git clone "$REPO" "$TARGET_DIR" || { echo "Clone failed. Set REPO env var or clone manually."; exit 1; }
else
  echo "Updating existing $TARGET_DIR..."
  (cd "$TARGET_DIR" && git pull --ff-only || true)
fi

cd "$TARGET_DIR"

echo "Handing off to full interactive Titan bootstrap (this will ask questions and end with healthcheck)..."
exec ./avalanchego/scripts/titan-server-bootstrap.sh "$@"
