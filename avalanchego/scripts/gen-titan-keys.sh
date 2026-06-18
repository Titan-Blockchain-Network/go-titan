#!/usr/bin/env bash
#
# Convenience wrapper for generating Titan node keys.
#
# Examples:
#   ./scripts/gen-titan-keys.sh                    # regular node
#   ./scripts/gen-titan-keys.sh --genesis          # for the very first bootstrapper
#   ./scripts/gen-titan-keys.sh --dir=/tmp/my-keys --genesis
#

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AVALANCHE_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$AVALANCHE_DIR"

exec go run scripts/gen-titan-keys.go "$@"
