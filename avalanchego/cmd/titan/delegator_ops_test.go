package main

import (
	"strings"
	"testing"
)

func TestValidateDelegatorStake(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		amount  float64
		wantErr string
	}{
		{name: "minimum", amount: 1},
		{name: "typical", amount: 100},
		{name: "below minimum", amount: 0.25, wantErr: "at least"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validateDelegatorStake(tt.amount)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateDelegatorStake(%v) unexpected error: %v", tt.amount, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateDelegatorStake(%v) = %v, want error containing %q", tt.amount, err, tt.wantErr)
			}
		})
	}
}
