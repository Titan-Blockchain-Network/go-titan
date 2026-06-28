package main

import (
	"strings"
	"testing"

	"github.com/ava-labs/avalanchego/genesis"
)

func TestValidateSatelliteRegistration(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		stake     float64
		satellite bool
		wantErr   string
	}{
		{name: "not satellite", stake: 100, satellite: false},
		{name: "satellite sufficient stake", stake: 2000, satellite: true},
		{name: "satellite insufficient stake", stake: 500, satellite: true, wantErr: "satellite registration requires"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validateSatelliteRegistration(tt.stake, tt.satellite)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateSatelliteRegistration() = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestFormatSatelliteFeeds(t *testing.T) {
	t.Parallel()
	cfg := genesis.TitanParams.EconomicsConfig.SatelliteOracle
	out := formatSatelliteFeeds(cfg)
	if !strings.Contains(out, "BTC/USD") {
		t.Fatalf("formatSatelliteFeeds = %q", out)
	}
}