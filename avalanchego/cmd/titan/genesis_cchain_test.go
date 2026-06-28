// C-chain genesis document tests.
package main

import (
	"encoding/json"
	"testing"
)

func TestDefaultCChainGenesis(t *testing.T) {
	t.Parallel()
	alloc := map[string]cChainAccount{
		"0x0123456789abcdef0123456789abcdef01234567": {Balance: "0xde0b6b3a7640000"},
	}
	raw, err := defaultCChainGenesis(424242, alloc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var doc cChainGenesisDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("invalid cChain JSON: %v", err)
	}
	if doc.Config.ChainID != 424242 {
		t.Fatalf("chainId = %d, want 424242", doc.Config.ChainID)
	}
	if doc.Coinbase != "0x0100000000000000000000000000000000000000" {
		t.Fatalf("coinbase = %q, want Flare system coinbase", doc.Coinbase)
	}
}
