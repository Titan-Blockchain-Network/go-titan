package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseHexUint64(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   string
		want uint64
	}{
		{in: "0x0", want: 0},
		{in: "0x2a", want: 42},
		{in: "2a", want: 42},
		{in: "  0x10  ", want: 16},
	}
	for _, tt := range tests {
		got, err := parseHexUint64(tt.in)
		if err != nil {
			t.Fatalf("parseHexUint64(%q): %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("parseHexUint64(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestExpectedTreasuryEthAddr(t *testing.T) {
	t.Parallel()
	addr, err := expectedTreasuryEthAddr()
	if err != nil {
		t.Fatalf("expectedTreasuryEthAddr: %v", err)
	}
	if !strings.HasPrefix(addr, "0x") || len(addr) != 42 {
		t.Fatalf("unexpected treasury address format: %q", addr)
	}
}

func TestExpectedTreasuryEthAddrFromDiskGenesis(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	genesisDir := filepath.Join(dir, "avalanchego", "genesis")
	if err := os.MkdirAll(genesisDir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{
		"networkID": 888,
		"allocations": [{
			"ethAddr": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
			"avaxAddr": "X-titan15428vq2uzwhm3taey9sr9x5vm6tk78ewnalta5",
			"initialAmount": 0,
			"unlockSchedule": [{"amount": 1}]
		}],
		"startTime": 1,
		"initialStakeDuration": 1,
		"initialStakeDurationOffset": 1,
		"initialStakedFunds": [],
		"initialStakers": [],
		"cChainGenesis": "{\"alloc\":{},\"config\":{\"chainId\":888}}"
	}`
	if err := os.WriteFile(filepath.Join(genesisDir, "genesis_titan.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	origWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	addr, err := expectedTreasuryEthAddr()
	if err != nil {
		t.Fatalf("expectedTreasuryEthAddr: %v", err)
	}
	want := "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	if !strings.EqualFold(addr, want) {
		t.Fatalf("treasury eth = %q, want %q", addr, want)
	}
}

func TestFetchCChainTip(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result": map[string]string{
				"number":    "0x64",
				"timestamp": "0x3e8",
			},
		})
	}))
	defer srv.Close()

	tip, err := fetchCChainTip(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("fetchCChainTip: %v", err)
	}
	if tip.number != 100 || tip.timestamp != 1000 {
		t.Fatalf("tip = %+v, want number=100 timestamp=1000", tip)
	}
}