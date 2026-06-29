package core

import (
	"math/big"
	"testing"

	"github.com/ava-labs/coreth/params"
	"github.com/holiman/uint256"
)

func TestSplitCChainBaseFeeFiftyPercent(t *testing.T) {
	t.Parallel()
	// 21_000 gas, 1 gwei base, 2 gwei tip → total 63_000 gwei; half of base (21_000) → pool 10_500
	gasUsed := uint64(21_000)
	baseFee := big.NewInt(1_000_000_000)
	total := new(uint256.Int).Mul(uint256.NewInt(gasUsed), uint256.NewInt(3_000_000_000))

	burn, pool := splitCChainBaseFee(total, gasUsed, baseFee, 50)
	wantPool := new(uint256.Int).Mul(uint256.NewInt(gasUsed), uint256.NewInt(500_000_000))
	if pool.Cmp(wantPool) != 0 {
		t.Fatalf("pool = %s, want %s", pool, wantPool)
	}
	wantBurn := new(uint256.Int).Sub(total, wantPool)
	if burn.Cmp(wantBurn) != 0 {
		t.Fatalf("burn = %s, want %s", burn, wantBurn)
	}
}

func TestSplitCChainBaseFeeZeroPercent(t *testing.T) {
	t.Parallel()
	total := uint256.NewInt(1_000_000)
	burn, pool := splitCChainBaseFee(total, 21_000, big.NewInt(1), 0)
	if pool.Sign() != 0 {
		t.Fatalf("pool = %s, want 0", pool)
	}
	if burn.Cmp(total) != 0 {
		t.Fatalf("burn = %s, want %s", burn, total)
	}
}

func TestSplitCChainBaseFeeHundredPercent(t *testing.T) {
	t.Parallel()
	total := uint256.NewInt(1_000_000)
	burn, pool := splitCChainBaseFee(total, 21_000, big.NewInt(1), 100)
	if burn.Sign() != 0 {
		t.Fatalf("burn = %s, want 0", burn)
	}
	if pool.Cmp(total) != 0 {
		t.Fatalf("pool = %s, want %s", pool, total)
	}
}

func TestTitanFeeDistributionConfig(t *testing.T) {
	t.Parallel()
	enabled, cfg := titanFeeDistributionConfig(params.TitanChainID)
	if !enabled {
		t.Fatal("Titan fee distribution should be enabled")
	}
	if cfg.CChainBaseFeeToValidatorsPercent != 50 {
		t.Fatalf("percent = %d, want 50", cfg.CChainBaseFeeToValidatorsPercent)
	}
	if cfg.RewardPoolAddress != "0x1000000000000000000000000000000000000004" {
		t.Fatalf("pool = %s", cfg.RewardPoolAddress)
	}

	disabled, _ := titanFeeDistributionConfig(params.FlareChainID)
	if disabled {
		t.Fatal("Flare chain should not use Titan fee distribution config")
	}
}
