package main

import (
	"fmt"
	"strings"

	"github.com/ava-labs/avalanchego/genesis"
)

func validateSatelliteRegistration(stakeTokens float64, satellite bool) error {
	cfg := genesis.TitanParams.EconomicsConfig.SatelliteOracle
	if !satellite {
		return nil
	}
	if stakeTokens < float64(cfg.MinValidatorStakeTokens) {
		return fmt.Errorf("satellite registration requires stake >= %d TITAN (got %.0f)",
			cfg.MinValidatorStakeTokens, stakeTokens)
	}
	if !cfg.Enabled {
		fmt.Println("  Note: satellite oracle contracts not yet active (Phase 2); registration metadata recorded.")
	}
	return nil
}

func formatSatelliteFeeds(cfg genesis.SatelliteOracleConfig) string {
	if len(cfg.FeedIDs) == 0 {
		return "(none configured)"
	}
	return strings.Join(cfg.FeedIDs, ", ")
}