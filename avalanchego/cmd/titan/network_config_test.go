// Network configuration tests.
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSlugNetworkName(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"My Custom Chain": "my-custom-chain",
		"  Titan  ":       "titan",
		"!!!":             "titan",
		"Chain_9000":      "chain-9000",
	}
	for in, want := range tests {
		if got := slugNetworkName(in); got != want {
			t.Fatalf("slugNetworkName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeHRP(t *testing.T) {
	t.Parallel()
	got := sanitizeHRP("My Custom Chain")
	if got != "mycustomchain" {
		t.Fatalf("sanitizeHRP = %q", got)
	}
}

func TestConfigureNetworkFromGenesis(t *testing.T) {
	dir := t.TempDir()
	avago := filepath.Join(dir, "avalanchego")
	constantsDir := filepath.Join(avago, "utils", "constants")
	if err := os.MkdirAll(constantsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	genesisDir := filepath.Join(avago, "genesis")
	if err := os.MkdirAll(genesisDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(genesisDir, "genesis_titan.json"), []byte(`{"networkID":1}`), 0o644); err != nil {
		t.Fatal(err)
	}

	sample := `package constants

const (
	TitanID      uint32 = 888
	TitanName      = "titan"
	TitanHRP      = "titan"
)
`
	path := filepath.Join(constantsDir, "network_ids.go")
	if err := os.WriteFile(path, []byte(sample), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(avago); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	if err := configureNetworkFromGenesis(424242, "Acme Chain"); err != nil {
		t.Fatalf("configure failed: %v", err)
	}

	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(updated)
	if !strings.Contains(text, "TitanID      uint32 = 424242") {
		t.Fatalf("TitanID not configured: %s", text)
	}
	if !strings.Contains(text, `TitanName      = "acme-chain"`) {
		t.Fatalf("TitanName not configured: %s", text)
	}
	if !strings.Contains(text, `TitanHRP      = "acmechain"`) {
		t.Fatalf("TitanHRP not configured: %s", text)
	}

	id, name, hrp, err := readNetworkIDsTitanValues()
	if err != nil {
		t.Fatal(err)
	}
	if id != 424242 || name != "acme-chain" || hrp != "acmechain" {
		t.Fatalf("read back id=%d name=%s hrp=%s", id, name, hrp)
	}
}

func TestConfigureNetworkFromGenesisIdempotent(t *testing.T) {
	dir := t.TempDir()
	avago := filepath.Join(dir, "avalanchego")
	constantsDir := filepath.Join(avago, "utils", "constants")
	genesisDir := filepath.Join(avago, "genesis")
	for _, p := range []string{constantsDir, genesisDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(genesisDir, "genesis_titan.json"), []byte(`{"networkID":888}`), 0o644); err != nil {
		t.Fatal(err)
	}

	sample := `package constants

const (
	TitanID      uint32 = 888
	TitanName      = "titan"
	TitanHRP      = "titan"
)
`
	path := filepath.Join(constantsDir, "network_ids.go")
	if err := os.WriteFile(path, []byte(sample), 0o644); err != nil {
		t.Fatal(err)
	}

	origWD, _ := os.Getwd()
	if err := os.Chdir(avago); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origWD)

	if err := configureNetworkFromGenesis(888, "Titan"); err != nil {
		t.Fatalf("idempotent configure failed: %v", err)
	}
}
