// (c) 2021, Flare Networks Limited. All rights reserved.

package core

import (
	"math/big"
	"testing"

	"github.com/ava-labs/coreth/params"
	"github.com/ava-labs/libevm/common"
)

func TestStateTransitionParamsTitanUsesFlarePath(t *testing.T) {
	st := &StateTransition{}
	burn, _, isFlare, isSongbird, err := stateTransitionVariants.GetValue(params.TitanChainID)(st)
	if err != nil {
		t.Fatalf("state transition params: %v", err)
	}
	if !isFlare {
		t.Fatal("Titan chain should use Flare state transition path")
	}
	if isSongbird {
		t.Fatal("Titan chain must not use Songbird path")
	}
	wantBurn := common.HexToAddress("0x000000000000000000000000000000000000dEaD")
	if burn != wantBurn {
		t.Fatalf("burn address = %s, want %s", burn, wantBurn)
	}
}

func TestStateTransitionParamsFlareStillRegistered(t *testing.T) {
	st := &StateTransition{}
	for _, chainID := range []*big.Int{params.FlareChainID, params.TitanChainID} {
		_, _, isFlare, _, err := stateTransitionVariants.GetValue(chainID)(st)
		if err != nil {
			t.Fatalf("chain %v: %v", chainID, err)
		}
		if !isFlare {
			t.Fatalf("chain %v expected Flare path", chainID)
		}
	}
}