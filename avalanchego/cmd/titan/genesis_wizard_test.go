// Genesis interactive prompt tests.
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPromptChainIDRetriesAfterLowValue(t *testing.T) {
	t.Parallel()

	// User enters 8888 (too low), then a valid ID.
	pr := &promptReader{reader: bufio.NewReader(strings.NewReader("8888\n250000\n"))}
	id, err := pr.askChainID("3366842")
	if err != nil {
		t.Fatalf("askChainID failed: %v", err)
	}
	if id != 250000 {
		t.Fatalf("chain ID = %d, want 250000", id)
	}
}

func TestPromptChainIDAcceptsDefault(t *testing.T) {
	t.Parallel()

	pr := &promptReader{reader: bufio.NewReader(strings.NewReader("\n"))}
	id, err := pr.askChainID("150000")
	if err != nil {
		t.Fatalf("askChainID failed: %v", err)
	}
	if id != 150000 {
		t.Fatalf("chain ID = %d, want default 150000", id)
	}
}

func TestRunGenesisCreateInteractiveRejectsThenAcceptsChainID(t *testing.T) {
	dir := t.TempDir()
	networkDir := filepath.Join(dir, "titan-network")
	contractsDir := filepath.Join(networkDir, "contracts")
	for _, p := range []string{networkDir, contractsDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"warp-messenger.hex", "distribution.hex"} {
		if err := os.WriteFile(filepath.Join(contractsDir, name), []byte("0x60006000"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	// Titan / TITAN / 8888 (reject) / 250000 / supply / one allocation / skip validators.
	stdin := strings.Join([]string{
		"Titan",
		"TITAN",
		"8888",
		"250000",
		"1000000",
		"0x0123456789abcdef0123456789abcdef01234567",
		"X-titan1qy352euf40x77qfrg4ncn27dauqjx3t8r0zhyn",
		"1000",
		"",  // end allocations
		"n", // no genesis validators
	}, "\n") + "\n"

	out := filepath.Join(networkDir, "origin.json")
	if err := runGenesisCreateFromReader([]string{"--output", out}, bufio.NewReader(strings.NewReader(stdin))); err != nil {
		t.Fatalf("interactive create failed: %v", err)
	}

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var cfg originConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("invalid origin.json: %v", err)
	}
	if cfg.NetworkID != 250000 {
		t.Fatalf("networkID = %d, want 250000 after retry", cfg.NetworkID)
	}
	if cfg.BlockchainName != "Titan" {
		t.Fatalf("blockchainName = %q", cfg.BlockchainName)
	}
}
