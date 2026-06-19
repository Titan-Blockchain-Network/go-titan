package main

import (
	"fmt"
)

const defaultValidatorStakeTitan = 2000000

// printAtlasValidatorAddCommand prints the recommended one-shot command to run on
// the treasury / first node. Join nodes keep API on localhost; no SSH required.
func printAtlasValidatorAddCommand(staker *genesisStakerExpectation, amount float64) {
	if staker == nil || staker.NodeID == "" {
		return
	}
	fmt.Println()
	fmt.Println("=== Register this node from ATLAS (treasury) ===")
	fmt.Println("Run on the first node that holds ~/master.key (API stays localhost-only):")
	fmt.Printf(`  cd ~/go-titan/avalanchego
  ./build/titan validator add \
    --from @/root/master.key \
    --uri http://127.0.0.1:9650 \
    --node-id %s \
    --bls-pub %s \
    --bls-pop %s \
    --amount %.0f
`, staker.NodeID, staker.PublicKey, staker.ProofOfPossession, amount)
	fmt.Println()
	fmt.Println("No SSH or tunnel to this join node is required — chain state is shared.")
}