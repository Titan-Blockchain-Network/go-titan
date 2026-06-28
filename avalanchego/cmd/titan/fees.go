package main

import (
	"fmt"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
)

func printNetworkEconomics() {
	params := genesis.TitanParams
	fmt.Println("\n--- Network economics (from genesis) ---")
	fmt.Printf("  Base tx fee:     %.6f tokens\n", float64(params.TxFee)/float64(units.Avax))
	fmt.Printf("  Min validator:   %.0f tokens\n", float64(params.MinValidatorStake)/float64(units.Avax))
	fmt.Printf("  Max validator:   %.0f tokens\n", float64(params.MaxValidatorStake)/float64(units.Avax))
	fmt.Printf("  Min delegator:   %.0f tokens\n", float64(params.MinDelegatorStake)/float64(units.Avax))
	fmt.Printf("  Min delegation fee: %.0f%%\n", float64(params.MinDelegationFee)/1e4)
	fmt.Printf("  Reward rate:     %.0f%% – %.0f%% annual (minting)\n",
		float64(params.RewardConfig.MinConsumptionRate)/1e6,
		float64(params.RewardConfig.MaxConsumptionRate)/1e6,
	)
	fmt.Printf("  Uptime required: %.0f%%\n", params.UptimeRequirement*100)
	fmt.Printf("  Dynamic gas:     min price %d (P-chain fee market)\n", params.DynamicFeeConfig.MinPrice)
	netID := constants.TitanID
	if id, err := deployedNetworkID(); err == nil {
		netID = id
	}
	fmt.Printf("  Network ID:      %d (%s)\n", netID, deployedNetworkName())
}
