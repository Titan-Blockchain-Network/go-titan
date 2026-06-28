#!/usr/bin/env bash
#
# End-to-end smoke test: unit tests, build, genesis create/apply (non-interactive).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AVAGO_DIR/.." && pwd)"

export PATH="${HOME}/.local/go/bin:/usr/local/go/bin:${PATH}"
export CGO_ENABLED=1
export GOPATH="$REPO_ROOT/.gopath"
export GOMODCACHE="${GOMODCACHE:-$REPO_ROOT/.gomodcache}"
mkdir -p "$GOPATH" "$GOMODCACHE"

if ! command -v go >/dev/null 2>&1; then
  echo "Go not found — run: $SCRIPT_DIR/install-dev.sh" >&2
  exit 1
fi
if ! command -v gcc >/dev/null 2>&1; then
  echo "gcc not found — run: sudo apt-get install -y build-essential" >&2
  exit 1
fi

cd "$AVAGO_DIR"

echo "=== [1/4] Unit tests (cmd/titan) ==="
if [[ -x "$SCRIPT_DIR/test-titan.sh" ]] && command -v jq >/dev/null 2>&1; then
  "$SCRIPT_DIR/test-titan.sh" --sequential
else
  go test ./cmd/titan/... -count=1 -v
fi

echo ""
echo "=== [2/4] Build titan + avalanchego ==="
# build.sh rsyncs into GOPATH/pkg/mod — ensure targets exist
source "$AVAGO_DIR/scripts/versions.sh"
mkdir -p "$GOPATH/pkg/mod/github.com/ava-labs/avalanchego@${avalanche_version}"
mkdir -p "$GOPATH/pkg/mod/github.com/ava-labs/coreth@${coreth_version}"
if ! grep -q 'replace github.com/ava-labs/coreth => ../coreth' "$AVAGO_DIR/go.mod" 2>/dev/null; then
  (cd "$AVAGO_DIR" && go mod edit -replace "github.com/ava-labs/coreth=../coreth")
fi
./scripts/build-titan.sh

echo ""
echo "=== [3/4] Genesis create (non-interactive defaults) ==="
SMOKE_DIR="$REPO_ROOT/titan-network-smoke-$$"
mkdir -p "$SMOKE_DIR/contracts"
cp "$REPO_ROOT/titan-network/contracts/warp-messenger.hex" "$SMOKE_DIR/contracts/" 2>/dev/null || \
  echo "0x60006000" > "$SMOKE_DIR/contracts/warp-messenger.hex"

ORIGIN_OUT="$SMOKE_DIR/origin.json"
./build/titan genesis create --output "$ORIGIN_OUT" --non-interactive

echo ""
echo "=== [4/4] Genesis apply (network creation + staking contract) ==="
./build/titan genesis apply --from "$ORIGIN_OUT"

echo ""
echo "=== Smoke fingerprint ==="
./build/titan genesis fingerprint

rm -rf "$SMOKE_DIR"
echo ""
echo "✓ Smoke test passed"