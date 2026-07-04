// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

package genesis

import (
	"fmt"
	"strings"

	"github.com/ava-labs/avalanchego/utils/constants"
)

const (
	FlareSystemCoinbaseAddress = "0x0100000000000000000000000000000000000000"
	FlareFeeSinkAddress        = "0x000000000000000000000000000000000000dEaD"
)

// FeeDistributionConfig controls how network fees are allocated to validators.
// Routing is enforced in coreth when Enabled is true (Phase 2 reward pool).
type FeeDistributionConfig struct {
	Enabled                          bool   `json:"enabled"`
	CChainBaseFeeToValidatorsPercent uint32 `json:"cChainBaseFeeToValidatorsPercent"`
	PChainTxFeeToValidatorsPercent   uint32 `json:"pChainTxFeeToValidatorsPercent"`
	RewardPoolAddress                string `json:"rewardPoolAddress"`
}

// SatelliteOracleConfig configures FTSO-style oracle participation for validators.
type SatelliteOracleConfig struct {
	Enabled                 bool     `json:"enabled"`
	RequireAtRegistration   bool     `json:"requireAtRegistration"`
	MinValidatorStakeTokens uint64   `json:"minValidatorStakeTokens"`
	FeedIDs                 []string `json:"feedIds"`
}

// NetworkEconomicsConfig groups modular provider-economics settings for Titan.
type NetworkEconomicsConfig struct {
	CChainSystemCoinbase string                `json:"cChainSystemCoinbase"`
	CChainFeeSink        string                `json:"cChainFeeSink"`
	FeeDistribution      FeeDistributionConfig `json:"feeDistribution"`
	SatelliteOracle      SatelliteOracleConfig `json:"satelliteOracle"`
}

func DefaultTitanNetworkEconomicsConfig() NetworkEconomicsConfig {
	return NetworkEconomicsConfig{
		CChainSystemCoinbase: FlareSystemCoinbaseAddress,
		CChainFeeSink:        FlareFeeSinkAddress,
		FeeDistribution: FeeDistributionConfig{
			Enabled:                          true,
			CChainBaseFeeToValidatorsPercent: 50,
			PChainTxFeeToValidatorsPercent:   0,
			RewardPoolAddress:                "0x1000000000000000000000000000000000000004",
		},
		SatelliteOracle: SatelliteOracleConfig{
			Enabled:                 false,
			RequireAtRegistration:   false,
			MinValidatorStakeTokens: 2000,
			FeedIDs:                 []string{"BTC/USD", "ETH/USD", "FLR/USD"},
		},
	}
}

func (c NetworkEconomicsConfig) Validate() error {
	if err := validateHexAddress(c.CChainSystemCoinbase, "cChainSystemCoinbase"); err != nil {
		return err
	}
	if err := validateHexAddress(c.CChainFeeSink, "cChainFeeSink"); err != nil {
		return err
	}
	if err := c.FeeDistribution.Validate(); err != nil {
		return err
	}
	if err := c.SatelliteOracle.Validate(); err != nil {
		return err
	}
	return nil
}

func (c FeeDistributionConfig) Validate() error {
	if c.CChainBaseFeeToValidatorsPercent > 100 {
		return fmt.Errorf("cChainBaseFeeToValidatorsPercent must be <= 100")
	}
	if c.PChainTxFeeToValidatorsPercent > 100 {
		return fmt.Errorf("pChainTxFeeToValidatorsPercent must be <= 100")
	}
	if c.Enabled && c.RewardPoolAddress != "" {
		if err := validateHexAddress(c.RewardPoolAddress, "rewardPoolAddress"); err != nil {
			return err
		}
	}
	return nil
}

func (c SatelliteOracleConfig) Validate() error {
	if c.MinValidatorStakeTokens == 0 {
		return fmt.Errorf("minValidatorStakeTokens must be > 0")
	}
	for _, feed := range c.FeedIDs {
		if strings.TrimSpace(feed) == "" {
			return fmt.Errorf("satellite feed IDs must be non-empty")
		}
	}
	return nil
}

func validateHexAddress(addr, field string) error {
	addr = strings.TrimSpace(addr)
	if !strings.HasPrefix(addr, "0x") || len(addr) != 42 {
		return fmt.Errorf("%s must be a 20-byte hex address", field)
	}
	return nil
}

func GetNetworkEconomicsConfig(networkID uint32) NetworkEconomicsConfig {
	if networkID == constants.TitanID {
		return TitanParams.EconomicsConfig
	}
	return NetworkEconomicsConfig{}
}
