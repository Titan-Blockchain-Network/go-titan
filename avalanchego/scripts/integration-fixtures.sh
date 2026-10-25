#!/usr/bin/env bash
#
# Materialize gitignored integration fixtures on a clean checkout.
# Sourced by integration-test.sh and e2e-four-validators.sh.
#
# Expects: REPO_ROOT, AVAGO_DIR, and log().
# Exports: TITAN_ORIGIN (committed origin, or a generated copy whose
# initialStakers match docker/keys).

# Public Hardhat dev keys (mnemonic "test test ... junk"). Never use on mainnet.
# Account #0 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
# Account #2 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
INTEGRATION_HARDHAT_TREASURY=ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
INTEGRATION_HARDHAT_DELEGATOR=5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

integration_write_dev_key() {
  local path="$1"
  local hex="$2"
  if [[ -s "$path" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$hex" >"$path"
  chmod 600 "$path" 2>/dev/null || true
  log "Wrote public Hardhat dev key $(basename "$path")"
}

integration_ensure_cli() {
  if [[ -x "$AVAGO_DIR/build/titan" ]]; then
    return 0
  fi
  if ! command -v go >/dev/null 2>&1; then
    echo "Go is required to build the titan CLI" >&2
    exit 1
  fi
  # The key check used to call ./build/titan before any build. On CI that is
  # exit 127 (command not found), and stderr was discarded.
  log "Building titan CLI..."
  mkdir -p "$AVAGO_DIR/build"
  (cd "$AVAGO_DIR" && go build -o build/titan ./cmd/titan)
}

integration_eth_addr() {
  local key_path="$1"
  "$AVAGO_DIR/build/titan" wallet addresses --from "@$key_path" \
    | awk '/C-Chain \(EVM\):/{print $3}'
}

integration_require_eth() {
  local key_path="$1"
  local want="$2"
  local label="$3"
  local got
  got="$(integration_eth_addr "$key_path")"
  if [[ -z "$got" ]]; then
    echo "could not derive an address from $key_path" >&2
    exit 1
  fi
  if [[ "${got,,}" != "${want,,}" ]]; then
    echo "$label key controls $got but integration origin allocation is $want" >&2
    echo "Replace the key file or update titan-network/integration.origin.json." >&2
    exit 1
  fi
}

# prepare_integration_fixtures generates missing wallet and staking keys and
# points TITAN_ORIGIN at a genesis whose initialStakers match docker/keys.
prepare_integration_fixtures() {
  local committed="$REPO_ROOT/titan-network/integration.origin.json"
  local keys_dir="$REPO_ROOT/docker/keys"
  local treasury="$REPO_ROOT/docker/integration/treasury.key"
  local delegator="$REPO_ROOT/docker/integration/delegator.key"
  local runtime="$REPO_ROOT/tmp/integration.origin.json"
  local generated=0
  local show node_id bls_pub bls_pop committed_node runtime_node

  integration_write_dev_key "$treasury" "$INTEGRATION_HARDHAT_TREASURY"
  integration_write_dev_key "$delegator" "$INTEGRATION_HARDHAT_DELEGATOR"

  if [[ ! -f "$keys_dir/staker.crt" || ! -f "$keys_dir/staker.key" || ! -f "$keys_dir/signer.key" ]]; then
    integration_ensure_cli
    log "Generating docker staking keys (clean checkout has none)..."
    "$AVAGO_DIR/build/titan" keys generate --dir "$keys_dir"
    generated=1
  else
    integration_ensure_cli
  fi

  show="$("$AVAGO_DIR/build/titan" keys show --dir "$keys_dir")"
  node_id="$(printf '%s\n' "$show" | awk '/^NodeID:/{print $2}')"
  bls_pub="$(printf '%s\n' "$show" | awk '/--bls-pub/{print $2}')"
  bls_pop="$(printf '%s\n' "$show" | awk '/--bls-pop/{print $2}')"
  if [[ -z "$node_id" || -z "$bls_pub" || -z "$bls_pop" ]]; then
    echo "could not parse NodeID / BLS key from: titan keys show --dir $keys_dir" >&2
    printf '%s\n' "$show" >&2
    exit 1
  fi

  committed_node="$(jq -r '.initialStakers[0].nodeID' "$committed")"
  if [[ "$node_id" == "$committed_node" ]]; then
    export TITAN_ORIGIN="$committed"
  else
    if [[ "$generated" -ne 1 ]]; then
      runtime_node=""
      if [[ -f "$runtime" ]]; then
        runtime_node="$(jq -r '.initialStakers[0].nodeID' "$runtime")"
      fi
      if [[ "$node_id" != "$runtime_node" ]]; then
        echo "docker/keys NodeID ($node_id) does not match integration.origin.json ($committed_node)" >&2
        echo "Remove docker/keys to generate a matching identity, or update initialStakers." >&2
        exit 1
      fi
    fi
    log "Writing genesis initialStakers for $node_id"
    mkdir -p "$(dirname "$runtime")"
    jq \
      --arg node "$node_id" \
      --arg pub "$bls_pub" \
      --arg pop "$bls_pop" \
      '.initialStakers[0].nodeID = $node
       | .initialStakers[0].signer.publicKey = $pub
       | .initialStakers[0].signer.proofOfPossession = $pop' \
      "$committed" >"$runtime"
    export TITAN_ORIGIN="$runtime"
  fi

  integration_require_eth "$treasury" "$(jq -r '.allocations[0].ethAddr' "$committed")" "treasury"
  integration_require_eth "$delegator" "$(jq -r '.allocations[1].ethAddr' "$committed")" "delegator"
  log "Integration origin: $TITAN_ORIGIN"
}
