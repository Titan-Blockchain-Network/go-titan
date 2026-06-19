package main

import (
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/bls/signer/localsigner"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
)

const defaultGenesisRewardAddress = "P-titan1qy352euf40x77qfrg4ncn27dauqjx3t8r0zhyn"

func embeddedGenesisExpectation() (*genesisStakerExpectation, error) {
	cfg := genesis.GetConfig(constants.TitanID)
	if len(cfg.InitialStakers) == 0 {
		return nil, fmt.Errorf("embedded genesis has no initialStakers")
	}
	s := cfg.InitialStakers[0]
	if s.Signer == nil {
		return nil, fmt.Errorf("embedded genesis staker missing BLS signer")
	}
	return &genesisStakerExpectation{
		NodeID:            s.NodeID.String(),
		PublicKey:         "0x" + hex.EncodeToString(s.Signer.PublicKey[:]),
		ProofOfPossession: "0x" + hex.EncodeToString(s.Signer.ProofOfPossession[:]),
	}, nil
}

func loadGenesisExpectation() (*genesisStakerExpectation, error) {
	if expect, err := embeddedGenesisExpectation(); err == nil {
		return expect, nil
	}
	return loadDiskGenesisExpectation()
}

func loadDiskGenesisExpectation() (*genesisStakerExpectation, error) {
	path, err := findGenesisJSONPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
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

func deriveStakerFromKeys(keysDir string) (*genesisStakerExpectation, error) {
	certPath := filepath.Join(keysDir, "staker.crt")
	signerPath := filepath.Join(keysDir, "signer.key")

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", certPath, err)
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, fmt.Errorf("bad PEM in %s", certPath)
	}
	stakeCert, err := staking.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse staking cert: %w", err)
	}
	nodeID := ids.NodeIDFromCert(stakeCert)

	signerBytes, err := os.ReadFile(signerPath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", signerPath, err)
	}
	blsSk, err := localsigner.FromBytes(signerBytes)
	if err != nil {
		return nil, fmt.Errorf("parse signer.key: %w", err)
	}
	pop, err := signer.NewProofOfPossession(blsSk)
	if err != nil {
		return nil, fmt.Errorf("derive proof of possession: %w", err)
	}

	return &genesisStakerExpectation{
		NodeID:            nodeID.String(),
		PublicKey:         "0x" + hex.EncodeToString(pop.PublicKey[:]),
		ProofOfPossession: "0x" + hex.EncodeToString(pop.ProofOfPossession[:]),
	}, nil
}

func findGenesisJSONPath() (string, error) {
	candidates := []string{
		"genesis/genesis_titan.json",
		"../genesis/genesis_titan.json",
		"../../genesis/genesis_titan.json",
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			abs, _ := filepath.Abs(path)
			return abs, nil
		}
	}
	wd, _ := os.Getwd()
	for dir := wd; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		path := filepath.Join(dir, "avalanchego", "genesis", "genesis_titan.json")
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
		path = filepath.Join(dir, "genesis", "genesis_titan.json")
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("genesis_titan.json not found (run from avalanchego/ or repo root)")
}

func findAvalanchegoDir() (string, error) {
	path, err := findGenesisJSONPath()
	if err != nil {
		return "", err
	}
	return filepath.Dir(filepath.Dir(path)), nil
}

func updateGenesisJSON(staker *genesisStakerExpectation, rewardAddress string) error {
	if rewardAddress == "" {
		rewardAddress = defaultGenesisRewardAddress
	}
	genesisPath, err := findGenesisJSONPath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(genesisPath)
	if err != nil {
		return fmt.Errorf("read genesis: %w", err)
	}

	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("parse genesis: %w", err)
	}

	stakerEntry := map[string]interface{}{
		"delegationFee": 0,
		"nodeID":        staker.NodeID,
		"rewardAddress": rewardAddress,
		"signer": map[string]string{
			"publicKey":         staker.PublicKey,
			"proofOfPossession": staker.ProofOfPossession,
		},
	}
	stakerJSON, err := json.Marshal([]interface{}{stakerEntry})
	if err != nil {
		return err
	}
	cfg["initialStakers"] = stakerJSON

	out, err := json.MarshalIndent(cfg, "", "    ")
	if err != nil {
		return err
	}
	out = append(out, '\n')

	tmp := genesisPath + ".tmp"
	if err := os.WriteFile(tmp, out, 0644); err != nil {
		return fmt.Errorf("write temp genesis: %w", err)
	}
	if err := os.Rename(tmp, genesisPath); err != nil {
		return fmt.Errorf("replace genesis: %w", err)
	}
	fmt.Printf("  Updated %s with NodeID %s\n", genesisPath, staker.NodeID)
	return nil
}

func rebuildBinaries() error {
	avagoDir, err := findAvalanchegoDir()
	if err != nil {
		return err
	}
	fmt.Printf("  Rebuilding binaries in %s (embeds updated genesis)...\n", avagoDir)

	buildScript := filepath.Join(avagoDir, "scripts", "build-titan.sh")
	if _, err := os.Stat(buildScript); err != nil {
		buildScript = filepath.Join(avagoDir, "scripts", "build.sh")
	}

	cmd := exec.Command("bash", buildScript)
	cmd.Dir = avagoDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rebuild failed: %w", err)
	}
	fmt.Println("  Rebuild complete.")
	return nil
}

func wipeDataDir(dataDir string) error {
	fmt.Printf("  Wiping data directory %s (required after genesis change)...\n", dataDir)
	if err := os.RemoveAll(filepath.Join(dataDir, "db")); err != nil {
		return fmt.Errorf("wipe db: %w", err)
	}
	if err := os.RemoveAll(filepath.Join(dataDir, "logs")); err != nil {
		return fmt.Errorf("wipe logs: %w", err)
	}
	// Remove chain metadata that can pin an old genesis.
	for _, name := range []string{"process.json", "staking", "plugins"} {
		_ = os.RemoveAll(filepath.Join(dataDir, name))
	}
	os.MkdirAll(filepath.Join(dataDir, "db"), 0755)
	os.MkdirAll(filepath.Join(dataDir, "logs"), 0755)
	return nil
}

// prepareGenesisNodeKeys ensures staking keys match the embedded genesis binary.
// When they do not match, it updates genesis_titan.json if needed, rebuilds, and wipes data.
func prepareGenesisNodeKeys(keysDir, dataDir, rewardAddress string, skipRebuild, noWipe bool) error {
	hadKeys := keysPresent(keysDir)
	if !hadKeys {
		fmt.Printf("No staking keys in %s — generating genesis keys...\n", keysDir)
		if err := generateTitanKeys(keysDir, true); err != nil {
			return err
		}
	}

	fmt.Println("Verifying keys against embedded genesis...")
	if verifyGenesisKeys(keysDir) {
		fmt.Println("  Keys match embedded genesis.")
		return nil
	}

	needsGenesisUpdate := !verifyGenesisKeysFromDisk(keysDir)
	if needsGenesisUpdate {
		if hadKeys {
			fmt.Println("  Keys do not match genesis — updating genesis_titan.json to match keys.")
		} else {
			fmt.Println("  Fresh keys generated — updating genesis to match.")
		}
		staker, err := deriveStakerFromKeys(keysDir)
		if err != nil {
			return err
		}
		if err := updateGenesisJSON(staker, rewardAddress); err != nil {
			return err
		}
	} else {
		fmt.Println("  Keys match on-disk genesis but binary is stale — rebuild required.")
	}

	if !skipRebuild {
		if err := rebuildBinaries(); err != nil {
			return err
		}
	} else {
		fmt.Println("  Skipping rebuild (--skip-rebuild). You MUST rebuild before starting the node.")
	}
	if !noWipe && (needsGenesisUpdate || !skipRebuild) {
		if err := wipeDataDir(dataDir); err != nil {
			return err
		}
	}

	fmt.Println("Re-verifying keys against on-disk genesis...")
	if !verifyGenesisKeysFromDisk(keysDir) {
		return fmt.Errorf("keys do not match genesis_titan.json after update")
	}
	fmt.Println("  Genesis and keys are aligned. Re-run bootstrap with ./build/titan if this process predates the rebuild.")
	return nil
}

