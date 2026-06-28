package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
	"github.com/ava-labs/avalanchego/utils/crypto/bls/signer/localsigner"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
)

const defaultGenesisKeysBackupDir = "/root/titan-genesis-backup"

var genesisKeyFilenames = []string{"staker.crt", "staker.key", "signer.key"}

type genesisStakerExpectation struct {
	NodeID            string
	PublicKey         string
	ProofOfPossession string
}

func copyFilePreservePerm(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("stat %s: %w", src, err)
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("read %s: %w", src, err)
	}
	perm := info.Mode().Perm()
	if strings.HasSuffix(dst, ".key") {
		perm = 0o600
	}
	if err := os.WriteFile(dst, data, perm); err != nil {
		return fmt.Errorf("write %s: %w", dst, err)
	}
	return nil
}

func archiveExistingGenesisBackup(backupDir string) error {
	if !keysPresent(backupDir) {
		return nil
	}
	snapshot := filepath.Join(backupDir, "snapshots", time.Now().UTC().Format("2006-01-02T15-04-05Z"))
	if err := os.MkdirAll(snapshot, 0o700); err != nil {
		return err
	}
	for _, name := range append(append([]string{}, genesisKeyFilenames...), "genesis_titan.json", "anchor.json", "backup-info.json", "README.txt") {
		src := filepath.Join(backupDir, name)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if err := os.Rename(src, filepath.Join(snapshot, name)); err != nil {
			if err := copyFilePreservePerm(src, filepath.Join(snapshot, name)); err != nil {
				return err
			}
			_ = os.Remove(src)
		}
	}
	fmt.Printf("  Previous genesis backup archived to %s\n", snapshot)
	return nil
}

// backupGenesisKeys copies genesis staking keys (and related files) to a protected folder on disk.
func backupGenesisKeys(keysDir, dataDir, backupDir string) error {
	if backupDir == "" {
		backupDir = defaultGenesisKeysBackupDir
	}
	if !keysPresent(keysDir) {
		return fmt.Errorf("no staking keys in %s to back up", keysDir)
	}

	if err := archiveExistingGenesisBackup(backupDir); err != nil {
		return fmt.Errorf("archive previous backup: %w", err)
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return err
	}

	for _, name := range genesisKeyFilenames {
		if err := copyFilePreservePerm(filepath.Join(keysDir, name), filepath.Join(backupDir, name)); err != nil {
			return fmt.Errorf("backup %s: %w", name, err)
		}
	}

	if genesisPath, err := findGenesisJSONPath(); err == nil {
		_ = copyFilePreservePerm(genesisPath, filepath.Join(backupDir, "genesis_titan.json"))
	}

	anchorPath := filepath.Join(originBundleDir(dataDir), originAnchorFile)
	if _, err := os.Stat(anchorPath); err == nil {
		_ = copyFilePreservePerm(anchorPath, filepath.Join(backupDir, "anchor.json"))
	}

	staker, err := deriveStakerFromKeys(keysDir)
	if err != nil {
		return err
	}
	genesisHash, _ := computeEmbeddedGenesisFingerprint()

	info := map[string]string{
		"backedUpAt":    time.Now().UTC().Format(time.RFC3339),
		"keysSourceDir": keysDir,
		"nodeID":        staker.NodeID,
		"genesisHash":   genesisHash,
		"blsPublicKey":  staker.PublicKey,
	}
	infoBytes, _ := json.MarshalIndent(info, "", "  ")
	if err := os.WriteFile(filepath.Join(backupDir, "backup-info.json"), infoBytes, 0o600); err != nil {
		return err
	}

	readme := fmt.Sprintf(`Titan Genesis Validator Backup
==============================
Backed up: %s
NodeID:    %s
Keys from: %s

Files:
  staker.crt, staker.key, signer.key  — genesis validator identity (KEEP SECRET)
  genesis_titan.json                  — genesis config used to build this network
  anchor.json                         — genesis fingerprint served to join nodes
  backup-info.json                    — machine-readable metadata

Copy this entire directory offline (USB, vault, etc.). Anyone with these keys
controls the genesis validator.
`, info["backedUpAt"], staker.NodeID, keysDir)
	if err := os.WriteFile(filepath.Join(backupDir, "README.txt"), []byte(readme), 0o600); err != nil {
		return err
	}

	fmt.Println("=== Genesis keys backed up ===")
	fmt.Printf("  Directory: %s (mode 0700)\n", backupDir)
	fmt.Printf("  NodeID:    %s\n", staker.NodeID)
	fmt.Println("  Copy this folder offline — it controls the genesis validator.")
	return nil
}

func generateTitanKeys(outDir string, genesis bool) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create directory %s: %w", outDir, err)
	}

	certPEM, keyPEM, err := staking.NewCertAndKeyBytes()
	if err != nil {
		return fmt.Errorf("generate staking certificate: %w", err)
	}

	certPath := filepath.Join(outDir, "staker.crt")
	keyPath := filepath.Join(outDir, "staker.key")
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", certPath, err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", keyPath, err)
	}

	tlsCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return fmt.Errorf("parse generated certificate: %w", err)
	}
	if tlsCert.Leaf == nil {
		tlsCert.Leaf, err = x509.ParseCertificate(tlsCert.Certificate[0])
		if err != nil {
			return fmt.Errorf("parse certificate leaf: %w", err)
		}
	}
	stakingCert, err := staking.ParseCertificate(tlsCert.Leaf.Raw)
	if err != nil {
		return fmt.Errorf("parse staking certificate: %w", err)
	}
	nodeID := ids.NodeIDFromCert(stakingCert)

	blsSk, err := localsigner.New()
	if err != nil {
		return fmt.Errorf("generate BLS signer key: %w", err)
	}
	signerPath := filepath.Join(outDir, "signer.key")
	if err := os.WriteFile(signerPath, blsSk.ToBytes(), 0o600); err != nil {
		return fmt.Errorf("write %s: %w", signerPath, err)
	}

	pop, err := signer.NewProofOfPossession(blsSk)
	if err != nil {
		return fmt.Errorf("create proof of possession: %w", err)
	}

	pkHex := hex.EncodeToString(pop.PublicKey[:])
	popHex := hex.EncodeToString(pop.ProofOfPossession[:])

	fmt.Println("--- Staking keys ---")
	fmt.Printf("Generated.\n\n")
	fmt.Printf("Output directory: %s\n\n", outDir)
	fmt.Printf("NodeID:              %s\n", nodeID)
	fmt.Printf("BLS Public Key:      0x%s\n", pkHex)
	fmt.Printf("Proof of Possession: 0x%s\n\n", popHex)
	fmt.Println("Files written:")
	fmt.Printf("  %s\n", certPath)
	fmt.Printf("  %s\n", keyPath)
	fmt.Printf("  %s\n\n", signerPath)

	if genesis {
		fmt.Println("Genesis bootstrap validator — add to initialStakers in genesis_titan.json, rebuild, reset data directories.")
		stakerEntry := map[string]interface{}{
			"nodeID":        nodeID.String(),
			"rewardAddress": "P-titan1REPLACE_WITH_YOUR_P_TITAN_ADDRESS",
			"delegationFee": 0,
			"signer": map[string]string{
				"publicKey":         "0x" + pkHex,
				"proofOfPossession": "0x" + popHex,
			},
		}
		pretty, _ := json.MarshalIndent(stakerEntry, "", "  ")
		fmt.Println(string(pretty))
	} else {
		fmt.Println("Join node — register on bootstrap:")
		printAtlasValidatorAddCommand(&genesisStakerExpectation{
			NodeID:            nodeID.String(),
			PublicKey:         "0x" + pkHex,
			ProofOfPossession: "0x" + popHex,
		}, defaultValidatorStakeTitan, defaultDelegationFeePercent)
	}
	fmt.Println("---")
	fmt.Println("Store private keys offline.")
	return secureKeysDir(outDir)
}

func keysShowMain(args []string) {
	fs := flag.NewFlagSet("keys show", flag.ExitOnError)
	dir := fs.String("dir", "/root/keys", "directory with staker.crt/key + signer.key")
	amount := fs.Float64("amount", defaultValidatorStakeTitan, "stake amount in TITAN")
	fs.Parse(args)

	staker, err := deriveStakerFromKeys(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "could not read keys from %s: %v\n", *dir, err)
		os.Exit(1)
	}
	fmt.Printf("NodeID:         %s\n", staker.NodeID)
	fmt.Printf("BLS Public Key: %s\n", staker.PublicKey)
	printAtlasValidatorAddCommand(staker, *amount, defaultDelegationFeePercent)
}

func secureKeysDir(dir string) error {
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("chmod %s: %w", dir, err)
	}
	return nil
}

func keysPresent(dir string) bool {
	for _, name := range []string{"staker.crt", "staker.key", "signer.key"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}

func ensureKeys(dir string, genesis bool) error {
	if keysPresent(dir) {
		return nil
	}
	fmt.Printf("No staking keys found in %s — generating fresh keys...\n", dir)
	return generateTitanKeys(dir, genesis)
}

func verifyGenesisKeys(keysDir string) bool {
	return verifyGenesisKeysWith(keysDir, loadGenesisExpectation)
}

func verifyGenesisKeysFromDisk(keysDir string) bool {
	return verifyGenesisKeysWith(keysDir, loadDiskGenesisExpectation)
}

func verifyGenesisKeysWith(keysDir string, loadExpect func() (*genesisStakerExpectation, error)) bool {
	expect, err := loadExpect()
	if err != nil {
		fmt.Printf("  Could not load genesis expectation: %v\n", err)
		return false
	}

	certPath := filepath.Join(keysDir, "staker.crt")
	signerPath := filepath.Join(keysDir, "signer.key")

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		fmt.Printf("  Could not read %s: %v\n", certPath, err)
		return false
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		fmt.Println("  Bad PEM in staker.crt")
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		fmt.Printf("  parse cert: %v\n", err)
		return false
	}
	stakeCert, err := staking.ParseCertificate(cert.Raw)
	if err != nil {
		fmt.Printf("  staking.ParseCertificate: %v\n", err)
		return false
	}
	nodeID := ids.NodeIDFromCert(stakeCert)

	ok := true
	if nodeID.String() != expect.NodeID {
		fmt.Printf("  ✗ NodeID mismatch: got %s, want %s\n", nodeID, expect.NodeID)
		ok = false
	} else {
		fmt.Printf("  ✓ NodeID matches genesis: %s\n", nodeID)
	}

	signerBytes, err := os.ReadFile(signerPath)
	if err != nil {
		fmt.Printf("  Could not read %s: %v\n", signerPath, err)
		return false
	}
	blsSk, err := localsigner.FromBytes(signerBytes)
	if err != nil {
		fmt.Printf("  invalid signer.key: %v\n", err)
		return false
	}
	pop, err := signer.NewProofOfPossession(blsSk)
	if err != nil {
		fmt.Printf("  could not derive POP from signer.key: %v\n", err)
		return false
	}

	gotPub := "0x" + hex.EncodeToString(pop.PublicKey[:])
	gotPop := "0x" + hex.EncodeToString(pop.ProofOfPossession[:])
	if gotPub != expect.PublicKey {
		fmt.Printf("  ✗ BLS public key mismatch\n")
		fmt.Printf("    got:  %s\n", gotPub)
		fmt.Printf("    want: %s\n", expect.PublicKey)
		ok = false
	} else {
		fmt.Println("  ✓ BLS public key matches genesis")
	}
	if gotPop != expect.ProofOfPossession {
		fmt.Println("  ✗ BLS proof-of-possession mismatch")
		ok = false
	} else {
		fmt.Println("  ✓ BLS proof-of-possession matches genesis")
	}
	return ok
}

func nodeConfigJSON(dataDir, publicIP, keysDir, bootIPs, bootIDs, httpHost string) string {
	if httpHost == "" {
		httpHost = "0.0.0.0"
	}
	allowedHosts := `"*"`
	if httpHost == "127.0.0.1" || httpHost == "localhost" {
		allowedHosts = `"localhost,127.0.0.1"`
	}
	return fmt.Sprintf(`{
  "network-id": "titan",
  "data-dir": "%s",
  "db-dir": "%s/db",
  "log-dir": "%s/logs",
  "http-host": "%s",
  "http-port": 9650,
  "staking-port": 9651,
  "public-ip": "%s",
  "staking-tls-cert-file": "%s/staker.crt",
  "staking-tls-key-file": "%s/staker.key",
  "staking-signer-key-file": "%s/signer.key",
  "bootstrap-ips": "%s",
  "bootstrap-ids": "%s",
  "http-allowed-hosts": %s
}`, dataDir, dataDir, dataDir, httpHost, publicIP, keysDir, keysDir, keysDir, bootIPs, bootIDs, allowedHosts)
}
