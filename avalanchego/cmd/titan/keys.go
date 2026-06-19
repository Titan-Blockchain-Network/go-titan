package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
	"github.com/ava-labs/avalanchego/utils/crypto/bls/signer/localsigner"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
)

type genesisStakerExpectation struct {
	NodeID            string
	PublicKey         string
	ProofOfPossession string
}

func generateTitanKeys(outDir string, genesis bool) error {
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", outDir, err)
	}

	certPEM, keyPEM, err := staking.NewCertAndKeyBytes()
	if err != nil {
		return fmt.Errorf("generate staking certificate: %w", err)
	}

	certPath := filepath.Join(outDir, "staker.crt")
	keyPath := filepath.Join(outDir, "staker.key")
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return fmt.Errorf("write %s: %w", certPath, err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
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
	if err := os.WriteFile(signerPath, blsSk.ToBytes(), 0600); err != nil {
		return fmt.Errorf("write %s: %w", signerPath, err)
	}

	pop, err := signer.NewProofOfPossession(blsSk)
	if err != nil {
		return fmt.Errorf("create proof of possession: %w", err)
	}

	pkHex := hex.EncodeToString(pop.PublicKey[:])
	popHex := hex.EncodeToString(pop.ProofOfPossession[:])

	fmt.Println("================================================================")
	fmt.Printf("Titan node keys generated successfully!\n\n")
	fmt.Printf("Output directory: %s\n\n", outDir)
	fmt.Printf("NodeID:              %s\n", nodeID)
	fmt.Printf("BLS Public Key:      0x%s\n", pkHex)
	fmt.Printf("Proof of Possession: 0x%s\n\n", popHex)
	fmt.Println("Files written:")
	fmt.Printf("  %s\n", certPath)
	fmt.Printf("  %s\n", keyPath)
	fmt.Printf("  %s\n\n", signerPath)

	if genesis {
		fmt.Println(">>> THIS SET IS FOR THE GENESIS BOOTSTRAPPER <<<")
		fmt.Println("Update initialStakers in genesis/genesis_titan.json, rebuild, and wipe data dirs.")
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
		fmt.Println(">>> Keys for an additional Titan node <<<")
		fmt.Println("After starting the node, fund it and run: titan validator add --from @key --uri http://...:9650")
	}
	fmt.Println("================================================================")
	fmt.Println("BACK UP THE .key FILES NOW.")
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

func loadGenesisExpectation() (*genesisStakerExpectation, error) {
	candidates := []string{
		"genesis/genesis_titan.json",
		"../genesis/genesis_titan.json",
		"../../genesis/genesis_titan.json",
	}
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg struct {
			InitialStakers []struct {
				NodeID string `json:"nodeID"`
				Signer struct {
					PublicKey         string `json:"publicKey"`
					ProofOfPossession string `json:"proofOfPossession"`
				} `json:"signer"`
			} `json:"initialStakers"`
		}
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		if len(cfg.InitialStakers) == 0 {
			return nil, fmt.Errorf("no initialStakers in %s", path)
		}
		s := cfg.InitialStakers[0]
		return &genesisStakerExpectation{
			NodeID:            s.NodeID,
			PublicKey:         s.Signer.PublicKey,
			ProofOfPossession: s.Signer.ProofOfPossession,
		}, nil
	}
	return nil, fmt.Errorf("genesis_titan.json not found (run from avalanchego/ or repo root)")
}

func verifyGenesisKeys(keysDir string) bool {
	expect, err := loadGenesisExpectation()
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

func nodeConfigJSON(dataDir, publicIP, keysDir, bootIPs, bootIDs string) string {
	return fmt.Sprintf(`{
  "network-id": "titan",
  "data-dir": "%s",
  "db-dir": "%s/db",
  "log-dir": "%s/logs",
  "http-host": "0.0.0.0",
  "http-port": 9650,
  "staking-port": 9651,
  "public-ip": "%s",
  "staking-tls-cert-file": "%s/staker.crt",
  "staking-tls-key-file": "%s/staker.key",
  "staking-signer-key-file": "%s/signer.key",
  "bootstrap-ips": "%s",
  "bootstrap-ids": "%s",
  "http-allowed-hosts": "*"
}`, dataDir, dataDir, dataDir, publicIP, keysDir, keysDir, keysDir, bootIPs, bootIDs)
}