#!/usr/bin/env bash

set -euo pipefail

print_usage() {
  printf "Usage: build [OPTIONS]

  Build avalanchego

  Options:

    -r  Build with race detector
"
}

race=''
while getopts 'r' flag; do
  case "${flag}" in
    r)
      echo "Building with race detection enabled"
      race='-race'
      ;;
    *) print_usage
      exit 1 ;;
  esac
done

# Avalanchego root folder
AVALANCHE_PATH=$( cd "$( dirname "${BASH_SOURCE[0]}" )"; cd .. && pwd )
CORETH_PATH=$( cd "$( dirname "${BASH_SOURCE[0]}" )"; cd ../../coreth && pwd )
# Load the versions
source "$AVALANCHE_PATH"/scripts/versions.sh
# Load the constants
source "$AVALANCHE_PATH"/scripts/constants.sh

# Download dependencies
echo "Downloading dependencies..."
go mod download -modcacherw

build_args="$race"

echo "Syncing with sources at GOPATH: $GOPATH"

avalanche_mod_dir="$GOPATH/pkg/mod/github.com/ava-labs/avalanchego@$avalanche_version"
coreth_mod_dir="$GOPATH/pkg/mod/github.com/ava-labs/coreth@$coreth_version"
mkdir -p "$(dirname "$avalanche_mod_dir")" "$(dirname "$coreth_mod_dir")"
# go mod download -modcacherw leaves the module cache read-only; rsync needs write access.
if [[ -d "$avalanche_mod_dir" ]]; then
  chmod -R u+w "$avalanche_mod_dir"
  rm -rf "$avalanche_mod_dir"
fi
if [[ -d "$coreth_mod_dir" ]]; then
  chmod -R u+w "$coreth_mod_dir"
  rm -rf "$coreth_mod_dir"
fi
mkdir -p "$avalanche_mod_dir" "$coreth_mod_dir"

rsync -ar --delete "$AVALANCHE_PATH"/* "$avalanche_mod_dir"/
rsync -ar --delete "$CORETH_PATH"/* "$coreth_mod_dir"/

# Build avalanchego
"$AVALANCHE_PATH"/scripts/build_avalanche.sh $build_args

# Build coreth
"$AVALANCHE_PATH"/scripts/build_coreth.sh

# Exit build successfully if the AvalancheGo binary is created successfully
if [[ -f "$avalanchego_path" ]]; then
        echo "Build Successful"
        exit 0
else
        echo "Build failure" >&2
        exit 1
fi
