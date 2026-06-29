package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ava-labs/avalanchego/genesis"
)

const (
	warpMessengerAddress    = "0x1000000000000000000000000000000000000001"
	distributionPoolAddress = "0x1000000000000000000000000000000000000004"
	warpMessengerHexFile    = "titan-network/contracts/warp-messenger.hex"
	distributionHexFile     = "titan-network/contracts/distribution.hex"
)

func loadContractBytecode(relPath, label string) (string, error) {
	candidates := []string{relPath}
	if root, err := findRepoRoot(); err == nil {
		candidates = append(candidates, filepath.Join(root, relPath))
	}
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		code := strings.TrimSpace(string(data))
		if strings.HasPrefix(code, "0x") {
			return code, nil
		}
	}
	return "", fmt.Errorf("%s bytecode not found (expected %s)", label, relPath)
}

func loadWarpMessengerBytecode() (string, error) {
	return loadContractBytecode(warpMessengerHexFile, "warp messenger")
}

func loadDistributionBytecode() (string, error) {
	return loadContractBytecode(distributionHexFile, "distribution pool")
}

// injectStakingContracts ensures the C-chain genesis alloc includes system
// predeploys: Warp Messenger (staking/warp) and Distribution pool (fee share).
func injectStakingContracts(cChainGenesisJSON string) (string, error) {
	var doc cChainGenesisDoc
	if err := json.Unmarshal([]byte(cChainGenesisJSON), &doc); err != nil {
		return "", fmt.Errorf("parse cChainGenesis: %w", err)
	}
	if doc.Alloc == nil {
		doc.Alloc = make(map[string]cChainAccount)
	}
	changed := false

	if key := strings.ToLower(warpMessengerAddress); doc.Alloc[key].Code == "" {
		code, err := loadWarpMessengerBytecode()
		if err != nil {
			return "", err
		}
		doc.Alloc[key] = cChainAccount{Balance: "0x0", Code: code}
		changed = true
	}

	if key := strings.ToLower(distributionPoolAddress); doc.Alloc[key].Code == "" {
		code, err := loadDistributionBytecode()
		if err != nil {
			return "", err
		}
		doc.Alloc[key] = cChainAccount{Balance: "0x0", Code: code}
		changed = true
	}

	if doc.Coinbase == "" || strings.EqualFold(doc.Coinbase, "0x0000000000000000000000000000000000000000") {
		doc.Coinbase = genesis.FlareSystemCoinbaseAddress
		changed = true
	}

	if !changed {
		return cChainGenesisJSON, nil
	}

	raw, err := json.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func stakingContractPresent(cChainGenesisJSON string) bool {
	var doc cChainGenesisDoc
	if err := json.Unmarshal([]byte(cChainGenesisJSON), &doc); err != nil {
		return false
	}
	warp, ok := doc.Alloc[strings.ToLower(warpMessengerAddress)]
	if !ok || warp.Code == "" {
		return false
	}
	pool, ok := doc.Alloc[strings.ToLower(distributionPoolAddress)]
	return ok && pool.Code != ""
}
