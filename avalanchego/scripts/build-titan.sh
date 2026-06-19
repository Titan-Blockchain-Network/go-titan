#!/usr/bin/env bash
#
# Builds the titan CLI and avalanchego node binary (embeds current genesis).
#
# Output:
#   avalanchego/build/titan
#   avalanchego/build/avalanchego
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$AVAGO_DIR/build"

echo "Building titan CLI..."
(cd "$AVAGO_DIR" && go build -o build/titan ./cmd/titan)

echo "Building avalanchego (embeds genesis_titan.json)..."
(cd "$AVAGO_DIR" && ./scripts/build.sh)

echo "Built: $AVAGO_DIR/build/titan"
echo "Built: $AVAGO_DIR/build/avalanchego"
echo
echo "For fresh servers, use the full interactive bootstrap:"
echo "  ./scripts/titan-server-bootstrap.sh"
echo
echo "Try the CLI:"
echo "  ./build/titan --help"
echo "  ./build/titan node bootstrap --help"