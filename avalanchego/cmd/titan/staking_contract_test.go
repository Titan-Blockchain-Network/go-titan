package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInjectStakingContracts(t *testing.T) {
	dir := t.TempDir()
	contractsDir := filepath.Join(dir, "titan-network", "contracts")
	if err := os.MkdirAll(contractsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(contractsDir, "warp-messenger.hex"), []byte("0x60006000"), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	input := `{"alloc":{"0x0123456789abcdef0123456789abcdef01234567":{"balance":"0x1"}},"config":{"chainId":1}}`
	out, err := injectStakingContracts(input)
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}
	if !stakingContractPresent(out) {
		t.Fatal("staking contract not present after inject")
	}

	// idempotent
	out2, err := injectStakingContracts(out)
	if err != nil {
		t.Fatal(err)
	}
	if out2 != out {
		t.Fatal("second inject should be no-op")
	}
}

func TestStakingContractPresentFalse(t *testing.T) {
	if stakingContractPresent(`{"alloc":{}}`) {
		t.Fatal("expected false")
	}
}

func TestDefaultCChainIncludesStakingAfterInject(t *testing.T) {
	dir := t.TempDir()
	contractsDir := filepath.Join(dir, "titan-network", "contracts")
	if err := os.MkdirAll(contractsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(contractsDir, "warp-messenger.hex"), []byte("0x60006000"), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	raw, err := defaultCChainGenesis(888, map[string]cChainAccount{
		"0x0123456789abcdef0123456789abcdef01234567": {Balance: "0x1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err = injectStakingContracts(raw)
	if err != nil {
		t.Fatal(err)
	}
	var doc cChainGenesisDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	acct := doc.Alloc[strings.ToLower(warpMessengerAddress)]
	if acct.Code == "" {
		t.Fatal("warp messenger code missing")
	}
}
