// Copyright (C) 2019-2021, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

package genesis

import (
	"time"

	_ "embed"

	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/components/gas"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
	validatorfee "github.com/ava-labs/avalanchego/vms/platformvm/validators/fee"
)

var (
	//go:embed genesis_titan.json
	titanGenesisConfigJSON []byte

	// TitanParams are the params used for the TITAN blockchain
	TitanParams = Params{
		TxFeeConfig: TxFeeConfig{
			CreateAssetTxFee: units.MilliAvax,
			TxFee:            units.MilliAvax,
			DynamicFeeConfig: gas.Config{
				Weights: gas.Dimensions{
					gas.Bandwidth: 1,
					gas.DBRead:    1_000,
					gas.DBWrite:   1_000,
					gas.Compute:   4,
				},
				MaxCapacity:     1_000_000,
				MaxPerSecond:    100_000,
				TargetPerSecond: 50_000,
				MinPrice:        250,
				ExcessConversionConstant: 2_164_043,
			},
			ValidatorFeeConfig: validatorfee.Config{
				Capacity: 20_000,
				Target:   10_000,
				MinPrice: gas.Price(1 * units.NanoAvax),
				ExcessConversionConstant: 865_617,
			},
		},
		StakingConfig: StakingConfig{
			UptimeRequirement: .8,
			MinValidatorStake: 1 * units.Avax,
			MaxValidatorStake: 10000 * units.Avax,
			MinDelegatorStake: 0,
			MinDelegationFee:  0,
			MinStakeDuration:  24 * time.Hour,
			MaxStakeDuration:  365 * 24 * time.Hour,
			RewardConfig: reward.Config{
				MaxConsumptionRate: .12 * reward.PercentDenominator,
				MinConsumptionRate: .10 * reward.PercentDenominator,
				MintingPeriod:      365 * 24 * time.Hour,
				SupplyCap:          0 * units.MegaAvax,
			},
		},
		EconomicsConfig: DefaultTitanNetworkEconomicsConfig(),
	}
)
