#!/usr/bin/env bash
#
# Builds the titan CLI (the user-friendly operator tool for Titan).
#
# Output: avalanchego/build/titan
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$AVAGO_DIR/build"

echo "Building titan CLI..."
(cd "$AVAGO_DIR" && go build -o build/titan ./cmd/titan)

# Also make sure the regular node is built
if [[ ! -x "$AVAGO_DIR/build/avalanchego" ]]; then
  echo "Also building avalanchego node binary..."
  ./scripts/build.sh
fi

echo "Built: $AVAGO_DIR/build/titan"
echo
echo "For fresh servers, use the full interactive bootstrap instead:"
echo "  ./scripts/titan-server-bootstrap.sh"
echo
echo "Try the CLI directly:"
echo "  ./build/titan --help"
echo "  ./build/titan node bootstrap --help"
