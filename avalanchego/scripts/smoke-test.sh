#!/usr/bin/env bash
#
# End-to-end smoke test: unit tests, build, genesis create/apply (non-interactive).
#
# CI can skip redundant steps when binaries are built elsewhere:
#   ./scripts/smoke-test.sh --skip-tests --skip-build
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AVAGO_DIR/.." && pwd)"

SKIP_TESTS=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--skip-tests] [--skip-build]"
      echo "  Full local run: unit tests, build, genesis create/apply."
      echo "  --skip-tests   Skip cmd/titan unit tests (e.g. already run in CI)."
      echo "  --skip-build   Use existing build/titan (e.g. downloaded CI artifact)."
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

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

step=1
total=4
if $SKIP_TESTS; then
  total=$((total - 1))
fi
if $SKIP_BUILD; then
  total=$((total - 1))
fi

if ! $SKIP_TESTS; then
  echo "=== [$step/$total] Unit tests (cmd/titan) ==="
  if [[ -x "$SCRIPT_DIR/test-titan.sh" ]] && command -v jq >/dev/null 2>&1; then
    "$SCRIPT_DIR/test-titan.sh" --sequential
  else
    go test ./cmd/titan/... -count=1 -v
  fi
  echo ""
  step=$((step + 1))
fi

if ! $SKIP_BUILD; then
  echo "=== [$step/$total] Build titan + avalanchego ==="
  # build.sh rsyncs into GOPATH/pkg/mod — ensure targets exist
  source "$AVAGO_DIR/scripts/versions.sh"
  mkdir -p "$GOPATH/pkg/mod/github.com/ava-labs/avalanchego@${avalanche_version}"
  mkdir -p "$GOPATH/pkg/mod/github.com/ava-labs/coreth@${coreth_version}"
  if ! grep -q 'replace github.com/ava-labs/coreth => ../coreth' "$AVAGO_DIR/go.mod" 2>/dev/null; then
    (cd "$AVAGO_DIR" && go mod edit -replace "github.com/ava-labs/coreth=../coreth")
  fi
  ./scripts/build-titan.sh
  echo ""
  step=$((step + 1))
fi

if [[ ! -x "$AVAGO_DIR/build/titan" ]]; then
  echo "ERROR: build/titan not found (run build-titan.sh or pass a prebuilt binary)" >&2
  exit 1
fi

echo "=== [$step/$total] Genesis create (non-interactive defaults) ==="
SMOKE_DIR="$REPO_ROOT/titan-network-smoke-$$"
mkdir -p "$SMOKE_DIR/contracts"
cp "$REPO_ROOT/titan-network/contracts/warp-messenger.hex" "$SMOKE_DIR/contracts/" 2>/dev/null || \
  echo "0x60006000" > "$SMOKE_DIR/contracts/warp-messenger.hex"

ORIGIN_OUT="$SMOKE_DIR/origin.json"
./build/titan genesis create --output "$ORIGIN_OUT" --non-interactive

step=$((step + 1))
echo ""
echo "=== [$step/$total] Genesis apply (network creation + staking contract) ==="
./build/titan genesis apply --from "$ORIGIN_OUT"

echo ""
echo "=== Smoke fingerprint ==="
./build/titan genesis fingerprint

rm -rf "$SMOKE_DIR"
echo ""
echo "✓ Smoke test passed"