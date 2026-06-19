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

# If a local node is up, verify C→P export path (chain/asset alignment on every node;
# full treasury check when master key is present — required on ATLAS for validator add).
if curl -sf --max-time 2 "http://127.0.0.1:9650/ext/health" >/dev/null 2>&1; then
  MASTER_KEY="${TITAN_MASTER_KEY:-/root/master.key}"
  VERIFY_ARGS=(wallet verify-export --uri "http://127.0.0.1:9650")
  if [[ -f "$MASTER_KEY" ]]; then
    VERIFY_ARGS+=(--from "@${MASTER_KEY}")
  fi
  echo "Local node detected — verifying atomic export path (C→P)..."
  if "$AVAGO_DIR/build/titan" "${VERIFY_ARGS[@]}"; then
    echo "Export path OK."
  else
    echo "WARN: export-path verification failed (see above)."
    echo "  Fix: git pull && ./scripts/build-titan.sh"
    echo "  ATLAS: place treasury key at /root/master.key (or set TITAN_MASTER_KEY)"
  fi
  echo
fi

echo "For fresh servers, use the full interactive bootstrap:"
echo "  ./scripts/titan-server-bootstrap.sh"
echo
echo "Try the CLI:"
echo "  ./build/titan --help"
echo "  ./build/titan wallet verify-export --from @/root/master.key"
echo "  ./build/titan node bootstrap --help"