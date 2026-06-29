// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

package genesis

import (
	"testing"

	"github.com/ava-labs/avalanchego/utils/constants"
)

func TestDefaultTitanNetworkEconomicsConfigValid(t *testing.T) {
	cfg := DefaultTitanNetworkEconomicsConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config invalid: %v", err)
	}
	if cfg.CChainSystemCoinbase != FlareSystemCoinbaseAddress {
		t.Fatalf("coinbase = %q", cfg.CChainSystemCoinbase)
	}
	if cfg.FeeDistribution.CChainBaseFeeToValidatorsPercent != 50 {
		t.Fatalf("c-chain fee share = %d, want 50", cfg.FeeDistribution.CChainBaseFeeToValidatorsPercent)
	}
	if !cfg.FeeDistribution.Enabled {
		t.Fatal("fee distribution should be enabled")
	}
	if cfg.FeeDistribution.RewardPoolAddress != "0x1000000000000000000000000000000000000004" {
		t.Fatalf("reward pool = %q", cfg.FeeDistribution.RewardPoolAddress)
	}
}

func TestTitanParamsEconomicsConfigValid(t *testing.T) {
	if err := TitanParams.EconomicsConfig.Validate(); err != nil {
		t.Fatalf("TitanParams.EconomicsConfig invalid: %v", err)
	}
}

func TestFeeDistributionConfigRejectsInvalidPercent(t *testing.T) {
	cfg := FeeDistributionConfig{
		Enabled:                          true,
		CChainBaseFeeToValidatorsPercent: 101,
		RewardPoolAddress:                "0x0000000000000000000000000000000000000001",
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected validation error for percent > 100")
	}
}

func TestGetNetworkEconomicsConfigTitan(t *testing.T) {
	cfg := GetNetworkEconomicsConfig(constants.TitanID)
	if cfg.CChainSystemCoinbase != TitanParams.EconomicsConfig.CChainSystemCoinbase {
		t.Fatal("GetNetworkEconomicsConfig mismatch")
	}
}
