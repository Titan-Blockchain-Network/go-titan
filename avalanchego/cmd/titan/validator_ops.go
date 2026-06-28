package main

import (
	"fmt"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
)

const (
	defaultValidatorStakeTitan  = 2000
	minValidatorStakeTitan      = 1
	maxValidatorStakeTitan      = 10000
	defaultDelegationFeePercent = 0
	maxDelegationFeePercent     = 100
)

// pChainFundingBuffer is extra TITAN moved C→P so addPermissionlessValidator can
// pay stake plus P-chain / import fees (exporting exactly the stake amount leaves
// the treasury a few million nAVAX short).
const pChainFundingBuffer = 10 * units.Avax

func validateValidatorStake(amount float64) error {
	if amount < minValidatorStakeTitan {
		return fmt.Errorf("stake must be at least %d TITAN", minValidatorStakeTitan)
	}
	if amount > maxValidatorStakeTitan {
		return fmt.Errorf("stake %.0f TITAN exceeds network max (%d TITAN per validator)", amount, maxValidatorStakeTitan)
	}
	return nil
}

func parseDelegationFeePercent(percent float64) (uint32, error) {
	if percent < 0 || percent > maxDelegationFeePercent {
		return 0, fmt.Errorf("delegation fee must be between 0 and %d%%", maxDelegationFeePercent)
	}
	minFee := float64(genesis.TitanParams.MinDelegationFee) / float64(reward.PercentDenominator) * 100
	if percent < minFee {
		return 0, fmt.Errorf("delegation fee %.2f%% is below network minimum (%.2f%%)", percent, minFee)
	}
	shares := uint64(percent / 100 * float64(reward.PercentDenominator))
	return uint32(shares), nil
}

func formatDelegationFeePercent(shares uint32) float64 {
	return float64(shares) / float64(reward.PercentDenominator) * 100
}

func validatorStakeAmountNAVAX(amount float64) uint64 {
	return uint64(amount * float64(units.Avax))
}

func validatorFundingTargetNAVAX(stakeTokens float64) uint64 {
	return validatorStakeAmountNAVAX(stakeTokens) + pChainFundingBuffer
}

// printAtlasValidatorAddCommand prints the recommended one-shot command to run on
// the treasury / first node. Join nodes keep API on localhost; no SSH required.
func printAtlasValidatorAddCommand(staker *genesisStakerExpectation, amount float64, delegationFeePercent float64) {
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
    --amount %.0f \
    --delegation-fee %.2f
`, staker.NodeID, staker.PublicKey, staker.ProofOfPossession, amount, delegationFeePercent)
	fmt.Println()
	fmt.Println("No SSH or tunnel to this join node is required — chain state is shared.")
}
