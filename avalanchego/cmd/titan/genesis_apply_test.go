// Genesis apply tests.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunGenesisCreateNonInteractive(t *testing.T) {
	dir := t.TempDir()
	networkDir := filepath.Join(dir, "titan-network")
	contractsDir := filepath.Join(networkDir, "contracts")
	for _, p := range []string{networkDir, contractsDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(contractsDir, "warp-messenger.hex"), []byte("0x60006000"), 0o644); err != nil {
		t.Fatal(err)
	}
	example := filepath.Join(networkDir, "origin.example.json")
	if err := os.WriteFile(example, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	out := filepath.Join(networkDir, "origin.json")
	if err := runGenesisCreate([]string{"--output", out, "--non-interactive"}); err != nil {
		t.Fatalf("create failed: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var cfg originConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("invalid origin.json: %v", err)
	}
	if cfg.NetworkID != 424242 {
		t.Fatalf("networkID = %d", cfg.NetworkID)
	}
	if len(cfg.Allocations) != 1 {
		t.Fatalf("allocations = %d, want 1", len(cfg.Allocations))
	}
}

func TestRunGenesisApply(t *testing.T) {
	dir := t.TempDir()
	originDir := filepath.Join(dir, "titan-network")
	contractsDir := filepath.Join(originDir, "contracts")
	genesisDir := filepath.Join(dir, "avalanchego", "genesis")
	constantsDir := filepath.Join(dir, "avalanchego", "utils", "constants")
	for _, p := range []string{originDir, contractsDir, genesisDir, constantsDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(contractsDir, "warp-messenger.hex"), []byte("0x60006000"), 0o644); err != nil {
		t.Fatal(err)
	}
	networkIDs := `package constants

const (
	TitanID      uint32 = 888
	TitanName      = "titan"
	TitanHRP      = "titan"
)
`
	if err := os.WriteFile(filepath.Join(constantsDir, "network_ids.go"), []byte(networkIDs), 0o644); err != nil {
		t.Fatal(err)
	}

	origin := filepath.Join(originDir, "origin.json")
	originBody := `{
		"networkID": 424242,
		"allocations": [],
		"startTime": 1,
		"initialStakeDuration": 31536000,
		"initialStakeDurationOffset": 5400,
		"initialStakedFunds": [],
		"initialStakers": [],
		"cChainGenesis": "{\"alloc\":{},\"config\":{\"chainId\":424242}}",
		"message": "testchain",
		"blockchainName": "Test Chain",
		"tokenTicker": "TST"
	}`
	if err := os.WriteFile(origin, []byte(originBody), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	if err := runGenesisApply([]string{"--from", origin}); err != nil {
		t.Fatalf("apply failed: %v", err)
	}

	applied, err := os.ReadFile(filepath.Join(genesisDir, "genesis_titan.json"))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(applied, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["blockchainName"]; ok {
		t.Fatal("blockchainName should be stripped on apply")
	}
	if _, ok := raw["tokenTicker"]; ok {
		t.Fatal("tokenTicker should be stripped on apply")
	}

	var cChain string
	if err := json.Unmarshal(raw["cChainGenesis"], &cChain); err != nil {
		t.Fatal(err)
	}
	if !stakingContractPresent(cChain) {
		t.Fatal("apply should inject staking contract into cChainGenesis")
	}

	patched, err := os.ReadFile(filepath.Join(constantsDir, "network_ids.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(patched), "TitanID      uint32 = 424242") {
		t.Fatal("apply should configure network_ids.go from genesis")
	}
}

func TestRunGenesisApplyIdempotentWhenNetworkAlreadyConfigured(t *testing.T) {
	dir := t.TempDir()
	originDir := filepath.Join(dir, "titan-network")
	contractsDir := filepath.Join(originDir, "contracts")
	genesisDir := filepath.Join(dir, "avalanchego", "genesis")
	constantsDir := filepath.Join(dir, "avalanchego", "utils", "constants")
	for _, p := range []string{originDir, contractsDir, genesisDir, constantsDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(contractsDir, "warp-messenger.hex"), []byte("0x60006000"), 0o644); err != nil {
		t.Fatal(err)
	}

	networkIDs := `package constants

const (
	TitanID      uint32 = 888
	TitanName      = "titan"
	TitanHRP      = "titan"
)
`
	if err := os.WriteFile(filepath.Join(constantsDir, "network_ids.go"), []byte(networkIDs), 0o644); err != nil {
		t.Fatal(err)
	}

	origin := filepath.Join(originDir, "origin.json")
	originBody := `{
		"networkID": 888,
		"allocations": [],
		"startTime": 1,
		"initialStakeDuration": 31536000,
		"initialStakeDurationOffset": 5400,
		"initialStakedFunds": [],
		"initialStakers": [],
		"cChainGenesis": "{\"alloc\":{},\"config\":{\"chainId\":888}}",
		"message": "titan",
		"blockchainName": "Titan",
		"tokenTicker": "TITAN"
	}`
	if err := os.WriteFile(origin, []byte(originBody), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	if err := runGenesisApply([]string{"--from", origin}); err != nil {
		t.Fatalf("first apply failed: %v", err)
	}
	if err := runGenesisApply([]string{"--from", origin}); err != nil {
		t.Fatalf("idempotent apply failed: %v", err)
	}
}
