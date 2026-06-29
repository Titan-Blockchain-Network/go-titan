#!/usr/bin/env bash
#
# E2E: blockchain developer bootstrap + 3 providers join → 4 validators.
#
# Flow:
#   1. genesis apply (integration origin) + build
#   2. docker compose up: bootstrap (genesis validator) + 3 join nodes
#   3. wait for providers to sync
#   4. treasury runs provider onboard on each join node (from host / bootstrap perspective)
#   5. go test assertions (4 validators, stake add, status)
#
# Usage:
#   ./scripts/e2e-four-validators.sh
#   ./scripts/e2e-four-validators.sh --keep
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AVAGO_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.e2e.yml"
E2E_KEYS="$REPO_ROOT/docker/e2e/keys"
TREASURY_KEY="$REPO_ROOT/docker/integration/treasury.key"
BOOTSTRAP_KEYS="$REPO_ROOT/docker/keys"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
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

log() { echo "[e2e] $*"; }
cleanup() {
  if [[ "$KEEP" -eq 0 ]]; then
    log "Tearing down E2E compose stack..."
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
  else
    log "Leaving E2E stack running (--keep)"
  fi
}
trap cleanup EXIT

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 1
  fi
}
need_cmd docker
need_cmd jq
need_cmd gcc
need_cmd curl

wait_api() {
  local uri=$1
  for _ in $(seq 1 80); do
    if curl -sf --max-time 3 -X POST "$uri/ext/info" \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  echo "API not ready: $uri" >&2
  return 1
}

wait_bootstrapped() {
  local uri=$1
  for _ in $(seq 1 80); do
    if curl -sf --max-time 3 -X POST "$uri/ext/info" \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"info.isBootstrapped","params":{"chain":"P"}}' \
      | jq -e '.result.isBootstrapped == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  echo "P-chain not bootstrapped: $uri" >&2
  return 1
}

cd "$AVAGO_DIR"

log "Building titan + avalanchego (integration genesis)..."
./scripts/build-titan.sh

log "Idempotent genesis apply..."
./build/titan genesis apply --from "$TITAN_ORIGIN"

log "Generating provider staking keys (3 join nodes)..."
mkdir -p "$E2E_KEYS"
for i in 1 2 3; do
  dir="$E2E_KEYS/provider-$i"
  if [[ ! -f "$dir/signer.key" ]]; then
    ./build/titan keys generate --dir "$dir"
  fi
done

log "Verifying bootstrap keys match integration genesis..."
BOOTSTRAP_ID="$(./build/titan keys show --dir "$BOOTSTRAP_KEYS" 2>/dev/null | awk '/^NodeID:/{print $2}')"
if [[ "$BOOTSTRAP_ID" != "NodeID-DvJvi3HDFnpupwuvegZm2ZyaG8vGCeBZw" ]]; then
  echo "bootstrap NodeID ($BOOTSTRAP_ID) does not match integration.origin.json" >&2
  exit 1
fi

git_commit="local"
if git -C "$REPO_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  git_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
fi

log "Starting 4-node E2E stack (bootstrap + 3 providers)..."
docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
AVALANCHEGO_COMMIT="$git_commit" TITAN_ORIGIN="$TITAN_ORIGIN" \
  docker compose -f "$COMPOSE_FILE" up -d --build

log "Waiting for bootstrap API..."
wait_api "$TITAN_NODE_URI"
wait_bootstrapped "$TITAN_NODE_URI"

PROVIDER_URIS=(
  "http://127.0.0.1:19650"
  "http://127.0.0.1:19750"
  "http://127.0.0.1:19850"
)

log "Waiting for provider nodes to sync..."
for uri in "${PROVIDER_URIS[@]}"; do
  wait_api "$uri"
  wait_bootstrapped "$uri"
  log "  synced: $uri"
done

log "Funding delegator P-chain for stake-add test..."
if ! ./build/titan wallet fund-p \
  --from "@$REPO_ROOT/docker/integration/delegator.key" \
  --uri "$TITAN_NODE_URI" \
  --amount 6; then
  echo "delegator fund-p failed" >&2
  exit 1
fi

log "Onboarding 3 providers from treasury (bootstrap perspective)..."
for uri in "${PROVIDER_URIS[@]}"; do
  log "  provider onboard → $uri"
  if ! ./build/titan provider onboard \
    --from "@$TREASURY_KEY" \
    --uri "$uri" \
    --amount 10 \
    --delegation-fee 5 \
    --start-offset 45s; then
    echo "provider onboard failed for $uri" >&2
    docker compose -f "$COMPOSE_FILE" logs --tail=80 provider-1 provider-2 provider-3 bootstrap >&2 || true
    exit 1
  fi
done

log "Waiting for validator set to include all 4 nodes..."
sleep 50

log "Running E2E assertions..."
export TITAN_E2E=1
export TITAN_E2E_VALIDATOR_COUNT=4
export TITAN_E2E_BOOTSTRAP_URI="$TITAN_NODE_URI"
export TITAN_E2E_PROVIDER_URIS="$(IFS=,; echo "${PROVIDER_URIS[*]}")"
go test -tags=integration ./cmd/titan/... -count=1 -v -timeout=20m -run TestE2EFourValidatorNetwork

log "✓ Four-validator E2E passed"