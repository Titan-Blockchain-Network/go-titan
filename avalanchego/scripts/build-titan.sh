#!/usr/bin/env bash
#
# Builds the titan CLI and avalanchego node binary (embeds current genesis).
#
# Output:
#   avalanchego/build/titan
#   avalanchego/build/avalanchego
#
# Install to /usr/local/bin (used by systemd):
#   ./scripts/build-titan.sh --install
#   ./scripts/build-titan.sh --install --restart
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Bootstrap installs Go to /usr/local/go and writes /etc/profile.d/go.sh, but
# non-login shells (e.g. SSH one-liners) often skip that — find Go anyway.
ensure_go_in_path() {
  if command -v go >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f /etc/profile.d/go.sh ]]; then
    # shellcheck source=/dev/null
    source /etc/profile.d/go.sh
  fi
  if [[ -x /usr/local/go/bin/go ]]; then
    export PATH="/usr/local/go/bin:${PATH}"
  fi
  command -v go >/dev/null 2>&1
}

if ! ensure_go_in_path; then
  echo "ERROR: Go is not installed (not in PATH and not at /usr/local/go/bin/go)." >&2
  echo "If bootstrap already ran, try:" >&2
  echo "  export PATH=/usr/local/go/bin:\$PATH && go version" >&2
  echo "On a fresh server, run the full bootstrap (installs Go + deps + build):" >&2
  echo "  cd go-titan && ./avalanchego/scripts/titan-server-bootstrap.sh" >&2
  exit 1
fi

INSTALL=false
RESTART=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install|-i)
      INSTALL=true
      shift
      ;;
    --restart)
      RESTART=true
      INSTALL=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--install] [--restart]"
      echo "  Builds build/titan and build/avalanchego."
      echo "  --install copies to /usr/local/bin (stops running titan* services first)."
      echo "  --restart starts services again after --install."
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$AVAGO_DIR/build"

REPO_ROOT="$(cd "$AVAGO_DIR/.." && pwd)"
# Use local coreth checkout (required for fork compatibility)
if ! grep -q 'replace github.com/ava-labs/coreth => ../coreth' "$AVAGO_DIR/go.mod" 2>/dev/null; then
  (cd "$AVAGO_DIR" && go mod edit -replace "github.com/ava-labs/coreth=../coreth")
fi
if [[ -f "${TITAN_ORIGIN:-}" || -f "$REPO_ROOT/titan-network/origin.json" || -f "$REPO_ROOT/titan-network/origin.example.json" ]]; then
  echo "Syncing genesis from titan-network/..."
  apply_from=()
  if [[ -n "${TITAN_ORIGIN:-}" && -f "$TITAN_ORIGIN" ]]; then
    apply_from=(--from "$TITAN_ORIGIN")
  fi
  (cd "$AVAGO_DIR" && go run ./cmd/titan genesis apply "${apply_from[@]}" 2>/dev/null) || true
fi

echo "Building titan CLI..."
(cd "$AVAGO_DIR" && go build -o build/titan ./cmd/titan)

echo "Building avalanchego (embeds genesis_titan.json)..."
(cd "$AVAGO_DIR" && ./scripts/build.sh)

echo "Built: $AVAGO_DIR/build/titan"
echo "Built: $AVAGO_DIR/build/avalanchego"
echo

if $INSTALL; then
  INSTALL_ARGS=()
  if $RESTART; then
    INSTALL_ARGS+=(--restart)
  fi
  "$SCRIPT_DIR/install-titan-binaries.sh" "${INSTALL_ARGS[@]}"
  echo
fi

# If a local node is up, verify C→P export path (chain/asset alignment on every node;
# full treasury check when master key is present — required on ATLAS for validator add).
if curl -sf --max-time 2 "http://127.0.0.1:9650/ext/health" >/dev/null 2>&1; then
  MASTER_KEY="${TITAN_MASTER_KEY:-/root/master.key}"
  VERIFY_ARGS=(wallet verify-export --uri "http://127.0.0.1:9650")
  if [[ -f "$MASTER_KEY" ]]; then
    VERIFY_ARGS+=(--from "@${MASTER_KEY}")
  fi
  echo "Local node detected — verifying atomic export path (C→P)..."
  TITAN_CLI="$AVAGO_DIR/build/titan"
  if $INSTALL && command -v titan >/dev/null 2>&1; then
    TITAN_CLI="titan"
  fi
  if "$TITAN_CLI" "${VERIFY_ARGS[@]}"; then
    echo "Export path OK."
  else
    echo "WARN: export-path verification failed (see above)."
    echo "  Fix: git pull && ./scripts/build-titan.sh --install --restart"
    echo "  ATLAS: place treasury key at /root/master.key (or set TITAN_MASTER_KEY)"
  fi
  echo
fi

