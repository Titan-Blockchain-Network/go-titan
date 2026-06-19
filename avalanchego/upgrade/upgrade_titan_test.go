package upgrade

import (
	"testing"
	"time"

	"github.com/ava-labs/avalanchego/utils/constants"
)

func TestGetConfigTitanActivatesAP5AtGenesis(t *testing.T) {
	cfg := GetConfig(constants.TitanID)
	if !cfg.IsApricotPhase5Activated(time.Unix(0, 0)) {
		t.Fatal("Titan upgrade config must allow C→P export at genesis block timestamp 0")
	}
}