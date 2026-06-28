package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	warpMessengerAddress = "0x1000000000000000000000000000000000000001"
	warpMessengerHexFile = "titan-network/contracts/warp-messenger.hex"
)

func loadWarpMessengerBytecode() (string, error) {
	candidates := []string{warpMessengerHexFile}
	if root, err := findRepoRoot(); err == nil {
		candidates = append(candidates, filepath.Join(root, warpMessengerHexFile))
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
	return "", fmt.Errorf("warp messenger bytecode not found (expected %s)", warpMessengerHexFile)
}

// injectStakingContracts ensures the C-chain genesis alloc includes the Warp
// Messenger predeploy required for Avalanche L1 staking / warp flows.
func injectStakingContracts(cChainGenesisJSON string) (string, error) {
	var doc cChainGenesisDoc
	if err := json.Unmarshal([]byte(cChainGenesisJSON), &doc); err != nil {
		return "", fmt.Errorf("parse cChainGenesis: %w", err)
	}
	if doc.Alloc == nil {
		doc.Alloc = make(map[string]cChainAccount)
	}
	key := strings.ToLower(warpMessengerAddress)
	if existing, ok := doc.Alloc[key]; ok && existing.Code != "" {
		return cChainGenesisJSON, nil
	}

	code, err := loadWarpMessengerBytecode()
	if err != nil {
		return "", err
	}
	doc.Alloc[key] = cChainAccount{Balance: "0x0", Code: code}

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
	acct, ok := doc.Alloc[strings.ToLower(warpMessengerAddress)]
	return ok && acct.Code != ""
}
