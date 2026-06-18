#!/usr/bin/env bash
#
# install.sh - One-liner friendly installer/bootstrap for Titan blockchain node.
#
# Two ways to use:
# 1. Bare fresh server (nothing cloned yet) - one-liner:
#    curl -sSL https://raw.githubusercontent.com/Titan-Blockchain-Network/go-titan/main/install.sh | bash
#
# 2. After you have already cloned the repo manually (recommended for most cases):
#    git clone https://github.com/Titan-Blockchain-Network/go-titan.git
#    cd go-titan
#    ./avalanchego/scripts/titan-server-bootstrap.sh
#
# This script handles the bare case. When already cloned it detects and delegates cleanly.

set -euo pipefail

REPO="${REPO:-https://github.com/Titan-Blockchain-Network/go-titan.git}"
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

# Detect if we're already inside a valid checkout (recommended path after manual clone)
if [ -f "./avalanchego/scripts/titan-server-bootstrap.sh" ] || [ -f "../avalanchego/scripts/titan-server-bootstrap.sh" ]; then
  echo "Detected existing go-titan checkout. Running bootstrap directly (no re-clone)."
  if [ -f "./avalanchego/scripts/titan-server-bootstrap.sh" ]; then
    TARGET_DIR="."
  else
    TARGET_DIR=".."
  fi
  cd "$TARGET_DIR"
  exec ./avalanchego/scripts/titan-server-bootstrap.sh "$@"
fi

# Bare server path (one-liner curl | bash on fresh box with nothing cloned yet)
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
