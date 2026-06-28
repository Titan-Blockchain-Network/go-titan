package main

import (
	"fmt"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
)

type networkEconomics struct {
	BaseTxFeeTokens       float64
	MinValidatorStake     float64
	MaxValidatorStake     float64
	MinDelegatorStake     float64
	MinDelegationFeePct   float64
	MinConsumptionRatePct float64
	MaxConsumptionRatePct float64
	UptimeRequirementPct  float64
	DynamicFeeMinPrice    uint64
	NetworkID             uint32
	NetworkName           string
}

func networkEconomicsFromParams(params genesis.Params, networkID uint32, networkName string) networkEconomics {
	return networkEconomics{
		BaseTxFeeTokens:       float64(params.TxFee) / float64(units.Avax),
		MinValidatorStake:     float64(params.MinValidatorStake) / float64(units.Avax),
		MaxValidatorStake:     float64(params.MaxValidatorStake) / float64(units.Avax),
		MinDelegatorStake:     float64(params.MinDelegatorStake) / float64(units.Avax),
		MinDelegationFeePct:   formatDelegationFeePercent(params.MinDelegationFee),
		MinConsumptionRatePct: float64(params.RewardConfig.MinConsumptionRate) / float64(reward.PercentDenominator) * 100,
		MaxConsumptionRatePct: float64(params.RewardConfig.MaxConsumptionRate) / float64(reward.PercentDenominator) * 100,
		UptimeRequirementPct:  params.UptimeRequirement * 100,
		DynamicFeeMinPrice:    uint64(params.DynamicFeeConfig.MinPrice),
		NetworkID:             networkID,
		NetworkName:           networkName,
	}
}

func currentNetworkEconomics() networkEconomics {
	netID := constants.TitanID
	name := deployedNetworkName()
	if id, err := deployedNetworkID(); err == nil {
		netID = id
	}
	return networkEconomicsFromParams(genesis.TitanParams, netID, name)
}

func printNetworkEconomics() {
	e := currentNetworkEconomics()
	fmt.Println("\n--- Network economics (from genesis) ---")
	fmt.Printf("  Base tx fee:     %.6f tokens (burned; not paid to validators)\n", e.BaseTxFeeTokens)
	fmt.Printf("  Min validator:   %.0f tokens\n", e.MinValidatorStake)
	fmt.Printf("  Max validator:   %.0f tokens\n", e.MaxValidatorStake)
	fmt.Printf("  Min delegator:   %.0f tokens\n", e.MinDelegatorStake)
	fmt.Printf("  Min delegation fee: %.2f%%\n", e.MinDelegationFeePct)
	fmt.Printf("  Reward rate:     %.0f%% – %.0f%% annual (minted staking rewards)\n",
		e.MinConsumptionRatePct,
		e.MaxConsumptionRatePct,
	)
	fmt.Printf("  Uptime required: %.0f%%\n", e.UptimeRequirementPct)
	fmt.Printf("  Dynamic gas:     min price %d (P-chain fee market)\n", e.DynamicFeeMinPrice)
	fmt.Printf("  Network ID:      %d (%s)\n", e.NetworkID, e.NetworkName)
}
