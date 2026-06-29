#!/usr/bin/env bash
#
# Live-node integration test: docker-local bootstrap, validator add, stake add.
# Requires Docker, jq, gcc, and network access for image build.
#
# Usage:
#   ./scripts/integration-test.sh          # full run (up → test → down)
#   ./scripts/integration-test.sh --keep   # leave node running after tests
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AVAGO_DIR/.." && pwd)"

KEEP_NODE=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP_NODE=1 ;;
    -h|--help)
      echo "Usage: $0 [--keep]"
      exit 0
      ;;
  esac
done

export PATH="${HOME}/.local/go/bin:/usr/local/go/bin:${PATH}"
export CGO_ENABLED=1
export TITAN_ORIGIN="$REPO_ROOT/titan-network/integration.origin.json"
export TITAN_NODE_URI="${TITAN_NODE_URI:-http://127.0.0.1:9650}"

log() { echo "[integration] $*"; }
cleanup() {
  if [[ "$KEEP_NODE" -eq 0 ]]; then
    log "Stopping docker-local node..."
    "$REPO_ROOT/docker/docker-local.sh" down || true
  else
    log "Leaving node running (--keep)"
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker required for integration tests" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq required — install with: sudo apt-get install -y jq" >&2
  exit 1
fi
if ! command -v gcc >/dev/null 2>&1; then
  echo "gcc required for CGO build" >&2
  exit 1
fi

cd "$AVAGO_DIR"

log "Verifying docker staking keys match integration genesis..."
NODE_ID="$(./build/titan keys show --dir "$REPO_ROOT/docker/keys" 2>/dev/null | awk '/^NodeID:/{print $2}')"
if [[ "$NODE_ID" != "NodeID-DvJvi3HDFnpupwuvegZm2ZyaG8vGCeBZw" ]]; then
  echo "docker/keys NodeID ($NODE_ID) does not match integration.origin.json — update initialStakers" >&2
  exit 1
fi

log "Building titan + avalanchego (embeds integration genesis)..."
./scripts/build-titan.sh

log "Idempotent genesis apply (regression)..."
./build/titan genesis apply --from "$TITAN_ORIGIN"

log "Starting docker-local node..."
"$REPO_ROOT/docker/docker-local.sh" reset 2>/dev/null || true
"$REPO_ROOT/docker/docker-local.sh" up

log "Funding delegator P-chain for stake-add test..."
./build/titan wallet fund-p \
  --from "@$REPO_ROOT/docker/integration/delegator.key" \
  --uri "$TITAN_NODE_URI" \
  --amount 2

log "Running live integration tests..."
export TITAN_INTEGRATION=1
go test -tags=integration ./cmd/titan/... -count=1 -v -timeout=15m -run TestIntegrationLiveNetwork

log "✓ Integration tests passed"