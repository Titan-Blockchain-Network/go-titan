package main

import (
	"testing"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
)

func TestNetworkEconomicsFromParams(t *testing.T) {
	t.Parallel()
	e := networkEconomicsFromParams(genesis.TitanParams, constants.TitanID, "titan")

	if e.BaseTxFeeTokens != 0.001 {
		t.Fatalf("BaseTxFeeTokens = %v, want 0.001", e.BaseTxFeeTokens)
	}
	if e.MinValidatorStake != 1 {
		t.Fatalf("MinValidatorStake = %v, want 1", e.MinValidatorStake)
	}
	if e.MaxValidatorStake != 10000 {
		t.Fatalf("MaxValidatorStake = %v, want 10000", e.MaxValidatorStake)
	}
	if e.MinDelegatorStake != 0 {
		t.Fatalf("MinDelegatorStake = %v, want 0", e.MinDelegatorStake)
	}
	if e.MinDelegationFeePct != 0 {
		t.Fatalf("MinDelegationFeePct = %v, want 0", e.MinDelegationFeePct)
	}
	if e.MinConsumptionRatePct != 10 {
		t.Fatalf("MinConsumptionRatePct = %v, want 10", e.MinConsumptionRatePct)
	}
	if e.MaxConsumptionRatePct != 12 {
		t.Fatalf("MaxConsumptionRatePct = %v, want 12", e.MaxConsumptionRatePct)
	}
	if e.UptimeRequirementPct != 80 {
		t.Fatalf("UptimeRequirementPct = %v, want 80", e.UptimeRequirementPct)
	}
	if e.DynamicFeeMinPrice != uint64(genesis.TitanParams.DynamicFeeConfig.MinPrice) {
		t.Fatalf("DynamicFeeMinPrice = %d, want %d", e.DynamicFeeMinPrice, genesis.TitanParams.DynamicFeeConfig.MinPrice)
	}
	if e.NetworkID != constants.TitanID {
		t.Fatalf("NetworkID = %d, want %d", e.NetworkID, constants.TitanID)
	}
	if e.CChainFeeToValidatorsPercent != 50 {
		t.Fatalf("CChainFeeToValidatorsPercent = %d, want 50", e.CChainFeeToValidatorsPercent)
	}
	if !e.FeeDistributionEnabled {
		t.Fatal("fee distribution should be enabled for Phase B")
	}
	if e.SatelliteMinStakeTokens != 2000 {
		t.Fatalf("SatelliteMinStakeTokens = %d, want 2000", e.SatelliteMinStakeTokens)
	}
}

func TestFormatDelegationFeePercentMatchesRewardShares(t *testing.T) {
	t.Parallel()
	shares := uint32(0.05 * reward.PercentDenominator)
	if formatDelegationFeePercent(shares) != 5 {
		t.Fatalf("formatDelegationFeePercent(%d) = %v, want 5", shares, formatDelegationFeePercent(shares))
	}
}

func TestValidatorFundingUsesGenesisMaxStake(t *testing.T) {
	t.Parallel()
	max := float64(genesis.TitanParams.MaxValidatorStake) / float64(units.Avax)
	if err := validateValidatorStake(max); err != nil {
		t.Fatalf("validateValidatorStake(max) = %v", err)
	}
	if err := validateValidatorStake(max + 1); err == nil {
		t.Fatal("validateValidatorStake above max expected error")
	}
}
