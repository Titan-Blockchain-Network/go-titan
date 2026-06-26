#!/usr/bin/env bash
#
# Local development toolchain — avoids apt golang-go / gccgo-go conflicts.
# Installs Go from go.dev and build-essential (gcc) for CGO/BLS.
#
# Usage (from anywhere in the repo):
#   ./avalanchego/scripts/install-dev.sh
#   source ./avalanchego/scripts/install-dev.sh --env   # print export lines only
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GO_VERSION="${GO_VERSION:-$(grep '^go ' "$AVAGO_DIR/go.mod" | awk '{print $2}')}"
GO_VERSION="${GO_VERSION:-1.24.9}"

INSTALL_GO_DIR="${INSTALL_GO_DIR:-$HOME/.local/go}"
ENV_ONLY=false
if [[ "${1:-}" == "--env" ]]; then
  ENV_ONLY=true
fi

install_build_deps() {
  if command -v gcc >/dev/null 2>&1; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing build-essential (gcc/g++) — do NOT use apt golang-go or gccgo-go..."
    if command -v sudo >/dev/null 2>&1; then
      sudo apt-get update -y
      sudo apt-get install -y build-essential curl ca-certificates || {
        echo "WARN: could not install build-essential (sudo failed?). Install gcc manually." >&2
      }
    else
      echo "WARN: gcc not found and sudo unavailable. Install build-essential manually." >&2
    fi
  fi
  if ! command -v gcc >/dev/null 2>&1; then
    echo "WARN: gcc still not in PATH — go test/build will fail until build-essential is installed." >&2
  fi
}

install_go() {
  if [[ -x "$INSTALL_GO_DIR/bin/go" ]]; then
    echo "Go already at $INSTALL_GO_DIR ($( "$INSTALL_GO_DIR/bin/go" version ))"
    return 0
  fi

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) GOARCH=amd64 ;;
    aarch64|arm64) GOARCH=arm64 ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac

  TARBALL="go${GO_VERSION}.linux-${GOARCH}.tar.gz"
  URL="https://go.dev/dl/${TARBALL}"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  echo "Downloading $URL ..."
  curl -fsSL "$URL" -o "$TMP/$TARBALL"
  mkdir -p "$(dirname "$INSTALL_GO_DIR")"
  rm -rf "$INSTALL_GO_DIR"
  tar -C "$(dirname "$INSTALL_GO_DIR")" -xzf "$TMP/$TARBALL"
  echo "Installed Go $GO_VERSION to $INSTALL_GO_DIR"
}

install_build_deps
install_go

export PATH="$INSTALL_GO_DIR/bin:$PATH"
export CGO_ENABLED=1

if $ENV_ONLY; then
  echo "export PATH=\"$INSTALL_GO_DIR/bin:\$PATH\""
  echo "export CGO_ENABLED=1"
  exit 0
fi

echo ""
echo "Go: $(go version)"
echo "gcc: $(gcc --version | head -1)"
echo ""
echo "Add to your shell profile (~/.bashrc):"
echo "  export PATH=\"$INSTALL_GO_DIR/bin:\$PATH\""
echo ""
echo "Then from repo root (or already inside avalanchego/):"
echo "  cd avalanchego && go test ./cmd/titan/... -v"
echo "  cd avalanchego && ./scripts/build-titan.sh"