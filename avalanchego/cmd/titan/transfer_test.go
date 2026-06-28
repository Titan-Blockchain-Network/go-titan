package main

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchEthBaseFeeHexString(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result":  "0xfa",
		})
	}))
	defer srv.Close()

	got, err := fetchEthBaseFee(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("fetchEthBaseFee: %v", err)
	}
	if got.Cmp(big.NewInt(250)) != 0 {
		t.Fatalf("base fee = %s, want 250", got)
	}
}

func TestFetchEthBaseFeeDecimalNumber(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result":  json.Number("1000"),
		})
	}))
	defer srv.Close()

	got, err := fetchEthBaseFee(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("fetchEthBaseFee: %v", err)
	}
	if got.Cmp(big.NewInt(1000)) != 0 {
		t.Fatalf("base fee = %s, want 1000", got)
	}
}

func TestFetchEthBaseFeeNullUsesDefault(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result":  nil,
		})
	}))
	defer srv.Close()

	got, err := fetchEthBaseFee(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("fetchEthBaseFee: %v", err)
	}
	if got.Int64() != transferDefaultBaseFeeWei {
		t.Fatalf("base fee = %d, want default %d", got.Int64(), transferDefaultBaseFeeWei)
	}
}

func TestFetchEthBaseFeeRPCError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"error":   map[string]string{"message": "method not found"},
		})
	}))
	defer srv.Close()

	_, err := fetchEthBaseFee(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("expected RPC error")
	}
}