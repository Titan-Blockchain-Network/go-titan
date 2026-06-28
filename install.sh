#!/usr/bin/env bash
#
# Remote installer for Titan node bootstrap.
#
# Fresh host:
#   curl -sSL https://raw.githubusercontent.com/Titan-Blockchain-Network/go-titan/main/install.sh | bash
#
# Existing clone:
#   cd go-titan && ./avalanchego/scripts/titan-server-bootstrap.sh
#
set -euo pipefail

REPO="${REPO:-https://github.com/Titan-Blockchain-Network/go-titan.git}"
TARGET_DIR="${TARGET_DIR:-go-titan}"

echo "Titan node installer"

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Installing git, curl..."
  if command -v apt-get >/dev/null; then
    sudo apt-get update -y >/dev/null 2>&1 || true
    sudo apt-get install -y git curl ca-certificates >/dev/null 2>&1 || true
  fi
fi

if [ -f "./avalanchego/scripts/titan-server-bootstrap.sh" ] || [ -f "../avalanchego/scripts/titan-server-bootstrap.sh" ]; then
  echo "Existing checkout detected."
  if [ -f "./avalanchego/scripts/titan-server-bootstrap.sh" ]; then
    TARGET_DIR="."
  else
    TARGET_DIR=".."
  fi
  cd "$TARGET_DIR"
  exec ./avalanchego/scripts/titan-server-bootstrap.sh "$@"
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Cloning $REPO ..."
  git clone "$REPO" "$TARGET_DIR" || { echo "Clone failed."; exit 1; }
else
  echo "Updating $TARGET_DIR ..."
  (cd "$TARGET_DIR" && git pull --ff-only || true)
fi

cd "$TARGET_DIR"
exec ./avalanchego/scripts/titan-server-bootstrap.sh "$@"