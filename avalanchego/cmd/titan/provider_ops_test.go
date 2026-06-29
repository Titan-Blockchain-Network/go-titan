package main

import (
	"slices"
	"testing"
	"time"
)

func TestBuildProviderValidatorArgs(t *testing.T) {
	t.Parallel()
	args := buildProviderValidatorArgs(providerOnboardParams{
		from:          "@treasury.key",
		amount:        2000,
		days:          14,
		delegationFee: 5,
		startOffset:   5 * time.Minute,
		satellite:     true,
		uri:           "http://10.0.0.2:9650/",
		nodeID:        "NodeID-abc",
		blsPub:        "0x01",
		blsPop:        "0x02",
	})
	want := []string{
		"add",
		"--from", "@treasury.key",
		"--uri", "http://127.0.0.1:9650",
		"--target-uri", "http://10.0.0.2:9650",
		"--amount", "2000",
		"--duration-days", "14",
		"--delegation-fee", "5",
		"--start-offset", "5m0s",
		"--satellite",
		"--node-id", "NodeID-abc",
		"--bls-pub", "0x01",
		"--bls-pop", "0x02",
	}
	if !slices.Equal(args, want) {
		t.Fatalf("buildProviderValidatorArgs() = %v, want %v", args, want)
	}
}

func TestBuildProviderValidatorArgsMinimal(t *testing.T) {
	t.Parallel()
	args := buildProviderValidatorArgs(providerOnboardParams{
		from:   "@k",
		uri:    "http://join:9650",
		amount: defaultValidatorStakeTitan,
		days:   14,
	})
	if args[0] != "add" {
		t.Fatalf("first arg = %q, want add", args[0])
	}
	if slices.Contains(args, "--satellite") {
		t.Fatal("satellite flag should be omitted when false")
	}
	if slices.Contains(args, "--node-id") {
		t.Fatal("node-id should be omitted when empty")
	}
}
