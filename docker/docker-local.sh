#!/usr/bin/env bash
#
# Local Docker bootstrap node (127.0.0.1). Usage: up | status | logs | down | reset
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AVAGO_DIR="$REPO_ROOT/avalanchego"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.local.yml"
KEYS_DIR="$SCRIPT_DIR/keys"
ORIGIN_EXAMPLE="${TITAN_ORIGIN:-$REPO_ROOT/titan-network/origin.example.json}"

log() { echo "[docker-local] $*"; }
err() { echo "[docker-local] ERROR: $*" >&2; }

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    err "docker not found — install Docker Engine first."
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose plugin not found."
    exit 1
  fi
}

ensure_titan_cli() {
  export PATH="${HOME}/.local/go/bin:/usr/local/go/bin:${PATH}"
  if [[ -x "$AVAGO_DIR/build/titan" ]]; then
    return 0
  fi
  log "Building titan CLI (one-time)..."
  (cd "$AVAGO_DIR" && ./scripts/build-titan.sh)
}

prepare_genesis_and_keys() {
  if [[ ! -f "$ORIGIN_EXAMPLE" ]]; then
    err "Missing $ORIGIN_EXAMPLE"
    exit 1
  fi

  log "Applying example genesis (network 888 / Titan) for local image build..."
  "$AVAGO_DIR/build/titan" genesis apply --from "$ORIGIN_EXAMPLE"

  mkdir -p "$KEYS_DIR"
  if [[ -f "$KEYS_DIR/staker.crt" && -f "$KEYS_DIR/staker.key" && -f "$KEYS_DIR/signer.key" ]]; then
    log "Using existing keys in $KEYS_DIR"
  else
    log "Generating staking keys in $KEYS_DIR"
    "$AVAGO_DIR/build/titan" keys generate --dir "$KEYS_DIR"
  fi
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

cmd_up() {
  ensure_docker
  ensure_titan_cli
  prepare_genesis_and_keys

  local git_commit="local"
  if git -C "$REPO_ROOT" rev-parse HEAD >/dev/null 2>&1; then
    git_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  fi

  log "Building Docker image (first run may take several minutes)..."
  AVALANCHEGO_COMMIT="$git_commit" TITAN_ORIGIN="$ORIGIN_EXAMPLE" compose build --build-arg "TITAN_ORIGIN=$ORIGIN_EXAMPLE"

  log "Starting local node (localhost:9650)..."
  compose up -d

  log "Waiting for API (solo local node may report unhealthy until validators are added)..."
  for _ in $(seq 1 40); do
    if curl -sf --max-time 2 -X POST "http://127.0.0.1:9650/ext/info" \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' >/dev/null 2>&1; then
      echo ""
      log "Node API is up."
      cmd_status
      return 0
    fi
    sleep 3
  done

  err "API did not become ready — try: $0 logs"
  exit 1
}

cmd_status() {
  ensure_docker
  compose ps
  echo ""
  if curl -sf --max-time 3 -X POST "http://127.0.0.1:9650/ext/info" \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' >/dev/null 2>&1; then
    echo "API: OK — http://127.0.0.1:9650/ext/info"
    curl -sf --max-time 3 "http://127.0.0.1:9650/ext/health" | jq -r '.healthy' 2>/dev/null \
      | sed 's/^/Health endpoint (healthy): /' || true
    curl -sf --max-time 3 -X POST "http://127.0.0.1:9650/ext/info" \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' | jq -r '.result.nodeID // .' 2>/dev/null \
      | sed 's/^/NodeID: /' || true
  else
    echo "API: not ready yet"
  fi
  echo ""
  echo "Try:"
  echo "  curl -s http://127.0.0.1:9650/ext/health | jq ."
  echo "  $AVAGO_DIR/build/titan status --uri http://127.0.0.1:9650"
}

cmd_logs() {
  ensure_docker
  compose logs -f --tail=100
}

cmd_down() {
  ensure_docker
  compose down
}

cmd_reset() {
  ensure_docker
  compose down -v
  log "Removed container and local Docker volumes."
}

usage() {
  cat <<EOF
Usage: $0 {up|status|logs|down|reset}

  up      Apply example genesis, build image, start localhost node
  status  Container + API health
  logs    Follow container logs
  down    Stop container (keep volumes)
  reset   Stop and delete volumes (fresh chain data)
EOF
}

main() {
  case "${1:-up}" in
    up) cmd_up ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    down) cmd_down ;;
    reset) cmd_reset ;;
    -h|--help|help) usage ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"