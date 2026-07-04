package core

import (
	"math/big"

	agenesis "github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/coreth/params"
	"github.com/ava-labs/libevm/common"
	"github.com/holiman/uint256"
)

func titanFeeDistributionConfig(chainID *big.Int) (enabled bool, cfg agenesis.FeeDistributionConfig) {
	if chainID == nil || chainID.Cmp(params.TitanChainID) != 0 {
		return false, agenesis.FeeDistributionConfig{}
	}
	cfg = agenesis.GetNetworkEconomicsConfig(constants.TitanID).FeeDistribution
	return cfg.Enabled, cfg
}

// splitCChainBaseFee allocates [totalFee] between burn sink and validator pool.
// [percent] of the base-fee component (gasUsed * baseFee) goes to the pool; tips
// and the remaining base fee go to burn.
func splitCChainBaseFee(totalFee *uint256.Int, gasUsed uint64, baseFee *big.Int, percent uint32) (burn, pool *uint256.Int) {
	if totalFee == nil || totalFee.IsZero() || percent == 0 {
		return new(uint256.Int).Set(totalFee), uint256.NewInt(0)
	}
	if percent >= 100 {
		return uint256.NewInt(0), new(uint256.Int).Set(totalFee)
	}

	var baseComponent uint256.Int
	if baseFee != nil && baseFee.Sign() > 0 {
		bf, overflow := uint256.FromBig(baseFee)
		if overflow {
			baseComponent.Set(totalFee)
		} else {
			baseComponent.Mul(uint256.NewInt(gasUsed), bf)
		}
	} else {
		baseComponent.Set(totalFee)
	}
	if baseComponent.Cmp(totalFee) > 0 {
		baseComponent.Set(totalFee)
	}

	pool = new(uint256.Int).Mul(&baseComponent, uint256.NewInt(uint64(percent)))
	pool.Div(pool, uint256.NewInt(100))
	burn = new(uint256.Int).Sub(totalFee, pool)
	return burn, pool
}

func (st *StateTransition) creditCChainFees(fee *uint256.Int, gasUsed uint64) {
	if fee == nil || fee.IsZero() {
		return
	}

	chainID := st.evm.ChainConfig().ChainID
	burnAddress, _, _, _, err := stateTransitionVariants.GetValue(chainID)(st)
	if err != nil {
		return
	}

	enabled, fdCfg := titanFeeDistributionConfig(chainID)
	if !enabled {
		st.state.AddBalance(burnAddress, fee)
		return
	}

	poolAddr := common.HexToAddress(fdCfg.RewardPoolAddress)
	burn, pool := splitCChainBaseFee(fee, gasUsed, st.evm.Context.BaseFee, fdCfg.CChainBaseFeeToValidatorsPercent)
	if !burn.IsZero() {
		st.state.AddBalance(burnAddress, burn)
	}
	if !pool.IsZero() {
		st.state.AddBalance(poolAddr, pool)
	}
}
