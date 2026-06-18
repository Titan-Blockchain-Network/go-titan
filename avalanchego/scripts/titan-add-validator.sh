#!/usr/bin/env bash
#
# titan-add-validator.sh
#
# Complete, code-based procedure + automation to:
#  1. Transfer TITAN C -> P (using modern wallet, no keystore)
#  2. Add the CURRENT node as a permissionless primary network validator.
#
# This is derived directly from:
# - genesis/genesis.go + platformvm/state/state.go (syncGenesis puts initialStakers in)
# - vms/platformvm/txs/add_permissionless_validator_tx.go + executor
# - wallet/subnet/primary (the only supported way post-keystore removal)
# - node/node.go + info service (NodeID comes ONLY from staking TLS cert; POP from signer key)
# - health "bls" check and "node is not a validator" (vdrs.GetValidator)
#
# A node becomes a validator EXCLUSIVELY when the P-chain has a current staker record
# for its NodeID (with matching BLS key). Nothing else (no API flag enables it).
#
# Usage on the machine that will become the validator (e.g. Prometheus-1):
#   cd ~/go-titan/avalanchego
#   ./scripts/build.sh   # if needed
#   bash scripts/titan-add-validator.sh --privkey YOURHEX [--amount 2000000]
#
# Then, from any machine (e.g. on ATLAS via ssh), verify:
#   curl ... platform.getCurrentValidators | jq
#
# For the GENESIS node (ATLAS) itself showing as non-validator:
#   - It MUST be using the EXACT staker.{crt,key} + signer.key that were used
#     to generate the entry in genesis_titan.json (currently NodeID-6X6AdU2gc...)
#   - Its data dir must have been created with a binary whose compiled genesis
#     matches (full wipe + restart after any genesis edit + rebuild).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
URI="${URI:-http://127.0.0.1:9650}"
AMOUNT="${AMOUNT:-2000000}"
PRIVKEY=""

usage() {
  echo "Usage: $0 --privkey <64hex> [--uri http://127.0.0.1:9650] [--amount 2000000]"
  echo
  echo "The privkey must control a large C-chain balance on Titan (the 0x1b37... one)."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --privkey) PRIVKEY="$2"; shift 2 ;;
    --uri) URI="$2"; shift 2 ;;
    --amount) AMOUNT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg $1"; usage ;;
  esac
done

if [[ -z "$PRIVKEY" ]]; then
  echo "ERROR: --privkey is required"
  usage
fi

echo "=== TITAN add-validator (based on actual source) ==="
echo "Working dir: $AVAGO_DIR"
echo "Target node API: $URI"
echo "Amount to move C->P: $AMOUNT TITAN"
echo

command -v go >/dev/null || { echo "go is required"; exit 1; }

# 1. Make sure we have a fresh binary (embeds current genesis_titan.json)
if [[ ! -x "$AVAGO_DIR/build/avalanchego" ]]; then
  echo "Building avalanchego (this embeds the current genesis)..."
  (cd "$AVAGO_DIR" && ./scripts/build.sh)
fi

# 2. Quick local health / node info (proves API works, gets our real identity)
echo "Querying local node identity (this is what will be registered)..."
ID_JSON=$(curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' \
  "$URI/ext/info")

NODE_ID=$(echo "$ID_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("result",{}).get("nodeID","MISSING"))' 2>/dev/null || echo "MISSING")
POP_PUB=$(echo "$ID_JSON" | python3 -c '
import sys, json
d=json.load(sys.stdin).get("result",{}).get("nodePOP",{})
print(d.get("publicKey",""))
' 2>/dev/null || echo "")
POP_PROOF=$(echo "$ID_JSON" | python3 -c '
import sys, json
d=json.load(sys.stdin).get("result",{}).get("nodePOP",{})
print(d.get("proofOfPossession",""))
' 2>/dev/null || echo "")

echo "This node's NodeID: $NODE_ID"
echo "BLS pub:  ${POP_PUB:0:40}..."
echo "BLS pop:  ${POP_PROOF:0:40}..."
echo

if [[ "$NODE_ID" == "MISSING" || -z "$POP_PUB" ]]; then
  echo "ERROR: Could not get info.getNodeID. Is the node running on $URI ?"
  exit 1
fi

# 3. Do the C->P transfer using the real code path (no keystore)
echo "=== Step 1: C-Chain -> P-Chain transfer (using wallet SDK) ==="
echo "Running go transfer script (this calls IssueExportTx + IssueImportTx internally)..."

set +e
(cd "$AVAGO_DIR" && go run ./scripts/transfer-c-to-p/main.go \
  --privkey "$PRIVKEY" \
  --uri "$URI" \
  --amount "$AMOUNT")
TRANSFER_RC=$?
set -e

if [[ $TRANSFER_RC -ne 0 ]]; then
  echo "Transfer script failed (rc=$TRANSFER_RC). Check that:"
  echo "  - The privkey has sufficient unlocked balance on C (100B was prefunded)."
  echo "  - Node is fully bootstrapped (P health ok)."
  echo "  - You are running against the correct network (titan 888)."
  exit $TRANSFER_RC
fi

echo
echo "Transfer completed (or already had balance). Waiting a few seconds for acceptance..."
sleep 4

# 4. Verify we now have P balance on the derived address
echo "Checking P-chain balance of the funded P address (P-titan1lmwt4xrk2sepplkuh2v8v4pjzrldew5c07rcre)..."

echo "Checking P-chain balance of funded address..."
BAL_JSON=$(curl -sS -X POST -H 'Content-Type: application/json' --data '{
  "jsonrpc":"2.0","id":1,
  "method":"platform.getBalance",
  "params":{"addresses":["P-titan1lmwt4xrk2sepplkuh2v8v4pjzrldew5c07rcre"]}
}' "$URI/ext/bc/P" || echo '{}')

echo "$BAL_JSON" | python3 -c '
import sys, json
try:
  d = json.load(sys.stdin)
  res = d.get("result", {})
  bal = res.get("balance") or res.get("unlocked") or "?"
  print("P-balance (raw):", bal)
except Exception as e: print("Could not parse balance:", e)
' || true

# 5. Add as validator using the exact POP we just fetched from THIS node
echo
echo "=== Step 2: Issue AddPermissionlessValidatorTx ==="
echo "Using the NodeID + POP that THIS running node just reported."
echo "Start will be ~5 minutes in the future, duration 14 days, weight ~$AMOUNT."

set +e
(cd "$AVAGO_DIR" && go run ./scripts/add-validator/main.go \
  --privkey "$PRIVKEY" \
  --uri "$URI" \
  --node-id "$NODE_ID" \
  --bls-pubkey "$POP_PUB" \
  --bls-pop "$POP_PROOF" \
  --weight "$AMOUNT" \
  --start-offset-min 5 \
  --duration-days 14)
ADD_RC=$?
set -e

if [[ $ADD_RC -ne 0 ]]; then
  echo "Add validator tx failed."
  echo "Common causes (from code):"
  echo "  - Not enough P-balance yet (import not visible)"
  echo "  - Start time in the past or too soon"
  echo "  - The BLS POP does not match what the node is actually using"
  exit $ADD_RC
fi

echo
echo "=== Verification commands (run these) ==="
echo
echo "# Locally on this node:"
echo "curl -s $URI/ext/bc/P -X POST -H 'Content-Type: application/json' --data '"
echo '  {"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' "' | jq ."
echo
echo "# On the other node (ATLAS), to see if the new validator is visible network-wide:"
echo "ssh root@165.22.0.208 \"curl -s http://127.0.0.1:9650/ext/bc/P -X POST -H 'Content-Type: application/json' --data '"
echo '  {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"platform.getCurrentValidators\"}' "' | jq ."
echo
echo "# Check this node's own view of whether it is in the validator set (from its vdrs):"
echo "curl -s $URI/ext/health | jq '.checks.bls'"
echo
echo "# Full health:"
echo "curl -s $URI/ext/health | jq '{healthy, checks: {bls, bootstrapped, C: .checks.C.error, P: .checks.P.message.engine.consensus}}'"
echo

echo "=== Important notes from source review ==="
echo "1. No API flag enables validator status. The only thing that matters is a"
echo "   record in platform state (genesis or accepted AddPermissionlessValidatorTx)."
echo "2. For ATLAS (genesis staker) to appear: it must be using the titan-staking/"
echo "   certs on disk, and its data dir must match the genesis that was current"
echo "   when the chain was created. If getCurrentValidators returns [] for the"
echo "   genesis NodeID, wipe its data dir + restart with matching keys + rebuilt binary."
echo "3. After the tx is accepted and time passes the start time, the node will"
echo "   be in GetCurrentValidators and the bls health check will pass (\"correct BLS key\")."
echo

echo "Done. Run the verification curls above from both nodes."
