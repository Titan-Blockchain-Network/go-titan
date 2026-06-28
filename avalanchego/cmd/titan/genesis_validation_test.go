// Feature: genesis — validation helpers (chain ID, addresses, amounts).
package main

import (
	"testing"
)

func TestValidateCustomChainID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    uint32
		wantErr bool
	}{
		{name: "below minimum", input: "8888", wantErr: true},
		{name: "at minimum", input: "100000", want: 100000},
		{name: "example dev id", input: "424242", want: 424242},
		{name: "at maximum", input: "999999999", want: 999999999},
		{name: "above maximum", input: "1000000000", wantErr: true},
		{name: "not a number", input: "abc", wantErr: true},
		{name: "empty", input: "", wantErr: true},
		{name: "whitespace padded valid", input: "  250000  ", want: 250000},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := validateCustomChainID(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("validateCustomChainID(%q) expected error", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateCustomChainID(%q) unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("validateCustomChainID(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidateEthAddress(t *testing.T) {
	t.Parallel()
	if err := validateEthAddress("0x0123456789abcdef0123456789abcdef01234567"); err != nil {
		t.Fatalf("valid address rejected: %v", err)
	}
	if err := validateEthAddress("0x123"); err == nil {
		t.Fatal("expected invalid address error")
	}
}

func TestValidateTokenAmount(t *testing.T) {
	t.Parallel()
	nAvax, err := validateTokenAmount("1.5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if nAvax == 0 {
		t.Fatal("expected non-zero amount")
	}
	if _, err := validateTokenAmount(""); err == nil {
		t.Fatal("expected empty amount error")
	}
}

func TestTokensToWeiHex(t *testing.T) {
	t.Parallel()
	wei, err := tokensToWeiHex("1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if wei != "0xde0b6b3a7640000" {
		t.Fatalf("unexpected wei: %s", wei)
	}
}