// (c) 2021, Flare Networks Limited. All rights reserved.

package core

import (
	"testing"

	"github.com/ava-labs/coreth/params"
	"github.com/holiman/uint256"
)

func TestGetMaximumMintRequestTitanUsesFlareCap(t *testing.T) {
	flareCap := GetMaximumMintRequest(params.FlareChainID, 0)
	titanCap := GetMaximumMintRequest(params.TitanChainID, 0)
	if titanCap.Cmp(flareCap) != 0 {
		t.Fatalf("Titan mint cap %s != Flare mint cap %s", titanCap, flareCap)
	}
	if titanCap.Cmp(uint256.NewInt(0)) == 0 {
		t.Fatal("expected non-zero mint cap")
	}
}