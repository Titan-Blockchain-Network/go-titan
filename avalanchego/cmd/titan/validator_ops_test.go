package main

import (
	"strings"
	"testing"

	"github.com/ava-labs/avalanchego/utils/units"
)

func TestValidateValidatorStake(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		amount  float64
		wantErr string
	}{
		{name: "minimum", amount: 1},
		{name: "default", amount: defaultValidatorStakeTitan},
		{name: "maximum", amount: maxValidatorStakeTitan},
		{name: "below minimum", amount: 0.5, wantErr: "at least"},
		{name: "above maximum", amount: 10001, wantErr: "exceeds network max"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validateValidatorStake(tt.amount)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateValidatorStake(%v) unexpected error: %v", tt.amount, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateValidatorStake(%v) = %v, want error containing %q", tt.amount, err, tt.wantErr)
			}
		})
	}
}

func TestParseDelegationFeePercent(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		percent float64
		want    uint32
		wantErr bool
	}{
		{name: "zero", percent: 0, want: 0},
		{name: "five percent", percent: 5, want: 50_000},
		{name: "twenty five percent", percent: 25, want: 250_000},
		{name: "max", percent: 100, want: 1_000_000},
		{name: "negative", percent: -1, wantErr: true},
		{name: "over max", percent: 100.1, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseDelegationFeePercent(tt.percent)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseDelegationFeePercent(%v) expected error", tt.percent)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseDelegationFeePercent(%v): %v", tt.percent, err)
			}
			if got != tt.want {
				t.Fatalf("parseDelegationFeePercent(%v) = %d, want %d", tt.percent, got, tt.want)
			}
			if back := formatDelegationFeePercent(got); back != tt.percent {
				t.Fatalf("round trip %.2f -> %d -> %.2f", tt.percent, got, back)
			}
		})
	}
}

func TestValidatorFundingTargetNAVAX(t *testing.T) {
	t.Parallel()
	want := uint64(2000*units.Avax + pChainFundingBuffer)
	got := validatorFundingTargetNAVAX(defaultValidatorStakeTitan)
	if got != want {
		t.Fatalf("validatorFundingTargetNAVAX(%v) = %d, want %d", defaultValidatorStakeTitan, got, want)
	}
}

func TestDefaultDelegationFeeMatchesGenesis(t *testing.T) {
	t.Parallel()
	if defaultDelegationFeePercent != 0 {
		t.Fatalf("defaultDelegationFeePercent = %v, want 0", defaultDelegationFeePercent)
	}
}
