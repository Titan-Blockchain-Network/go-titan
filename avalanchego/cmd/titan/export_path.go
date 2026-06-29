package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/upgrade"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

const defaultMasterKeyPath = "/root/master.key"

type exportPathReport struct {
	ok       bool
	network  uint32
	cChainID ids.ID
	staking  ids.ID
	xAvax    ids.ID
}

// verifyExportPath checks that the node exposes consistent chain/asset IDs for C→P
// atomic exports and (optionally) that the treasury key is present and funded.
// validator add skips C→P when P-chain already holds enough stake.
func verifyExportPath(ctx context.Context, nodeURI, masterKeyPath string) exportPathReport {
	uri := strings.TrimRight(nodeURI, "/")
	report := exportPathReport{ok: true}

	fmt.Println("  --- Atomic export path (C→P / validator add) ---")

	snap, err := fetchChainAssetSnapshot(ctx, uri)
	if err != nil {
		fmt.Printf("  ✗ Could not query chain/asset IDs: %v\n", err)
		report.ok = false
		return report
	}
	report.network = snap.networkID
	report.cChainID = snap.cChainID
	report.staking = snap.pStakingID
	report.xAvax = snap.xAvaxAliasID

	expectedID, expectedErr := deployedNetworkID()
	if expectedErr != nil {
		fmt.Printf("  ! network ID check: %v\n", expectedErr)
	} else if snap.networkID != expectedID {
		fmt.Printf("  ✗ network ID %d does not match genesis (%d)\n", snap.networkID, expectedID)
		report.ok = false
	} else {
		fmt.Printf("  ✓ network ID %d\n", snap.networkID)
	}

	fmt.Printf("  ✓ C-chain ID %s\n", snap.cChainID)
	fmt.Printf("  ✓ P-chain staking asset %s\n", snap.pStakingID)

	if tip, err := fetchCChainTip(ctx, uri); err != nil {
		fmt.Printf("  ! C-chain tip lookup failed: %v\n", err)
	} else {
		up := upgrade.GetConfig(snap.networkID)
		ap5Active := up.IsApricotPhase5Activated(time.Unix(int64(tip.timestamp), 0))
		fmt.Printf("  ✓ C-chain tip block #%d timestamp %d (%s)\n",
			tip.number, tip.timestamp, time.Unix(int64(tip.timestamp), 0).UTC().Format(time.RFC3339))
		if ap5Active {
			fmt.Println("  ✓ Apricot Phase 5 active at tip — direct C→P export allowed")
		} else {
			fmt.Printf("  ✗ Apricot Phase 5 inactive at tip (fork @ %s) — C→P export returns \"wrong chain ID\"\n",
				up.ApricotPhase5Time.UTC().Format(time.RFC3339))
			fmt.Println("    Fix: git pull && ./scripts/build-titan.sh && sudo systemctl restart titan-node")
			report.ok = false
		}
	}

	if snap.xAvaxAliasID == ids.Empty {
		fmt.Println("  ! X-chain AVAX alias lookup failed (wallet uses P-chain staking asset)")
	} else if snap.xAvaxAliasID != snap.pStakingID {
		fmt.Printf("  ✓ X-chain AVAX alias %s differs from staking asset — wallet uses staking asset (required for export)\n",
			snap.xAvaxAliasID)
	} else {
		fmt.Printf("  ✓ X-chain AVAX alias matches staking asset %s\n", snap.pStakingID)
	}

	if masterKeyPath == "" {
		masterKeyPath = defaultMasterKeyPath
	}
	if _, err := os.Stat(masterKeyPath); err != nil {
		fmt.Printf("  ! Treasury key not found at %s (needed on ATLAS for validator add)\n", masterKeyPath)
		fmt.Printf("    Place the funded operator private key there, then: titan wallet verify-export --from @%s\n", masterKeyPath)
		return report
	}

	priv, err := loadKey("@" + masterKeyPath)
	if err != nil {
		fmt.Printf("  ✗ Treasury key %s unreadable: %v\n", masterKeyPath, err)
		report.ok = false
		return report
	}

	ethAddr := priv.PublicKey().EthAddress().Hex()
	if expected, err := expectedTreasuryEthAddr(); err == nil {
		if !strings.EqualFold(ethAddr, expected) {
			fmt.Printf("  ✗ Treasury key eth %s does not match genesis allocation %s\n", ethAddr, expected)
			fmt.Println("    validator add may fail or use wrong balances — use the key for the genesis treasury ethAddr")
			report.ok = false
		} else {
			fmt.Printf("  ✓ Treasury key matches genesis ethAddr %s\n", ethAddr)
		}
	}

	kc := secp256k1fx.NewKeychain(priv)
	w, err := primary.MakeWallet(ctx, uri, kc, kc, primary.WalletConfig{})
	if err != nil {
		fmt.Printf("  ✗ Wallet connect failed: %v\n", err)
		report.ok = false
		return report
	}

	wCtx := w.C().Builder().Context()
	if wCtx.BlockchainID != snap.cChainID {
		fmt.Printf("  ✗ Wallet C-chain ID %s != node %s — rebuild titan after git pull\n", wCtx.BlockchainID, snap.cChainID)
		report.ok = false
	}
	if wCtx.AVAXAssetID != snap.pStakingID {
		fmt.Printf("  ✗ Wallet asset %s != staking asset %s — rebuild titan after git pull\n", wCtx.AVAXAssetID, snap.pStakingID)
		report.ok = false
	} else {
		fmt.Printf("  ✓ Wallet export context aligned (C-chain + staking asset)\n")
	}

	pCtx := w.P().Builder().Context()
	pBalMap, err := w.P().Builder().GetBalance()
	if err != nil {
		fmt.Printf("  ! P-chain balance check failed: %v\n", err)
	} else {
		pBal := pBalMap[pCtx.AVAXAssetID]
		fmt.Printf("  ✓ Treasury P-chain balance: %.0f TITAN (spendable)\n", float64(pBal)/float64(units.Avax))
		if pBal >= uint64(defaultValidatorStakeTitan*float64(units.Avax)) {
			fmt.Println("  ✓ P-chain funded — validator add will skip C→P export")
		} else {
			fmt.Println("  ! P-chain balance low — validator add will move funds from C→P (requires working export path)")
		}
	}

	cBal, err := queryCChainBalance(ctx, uri, ethAddr)
	if err != nil {
		fmt.Printf("  ! C-chain balance check failed: %v\n", err)
	} else {
		fmt.Printf("  ✓ Treasury C-chain balance: %s TITAN\n", formatHumanTitan(cBal, 18))
	}

	if report.ok {
		fmt.Println("  ✓ Export path ready for validator add")
	} else {
		fmt.Println("  ✗ Export path checks failed — fix issues above, then: git pull && ./scripts/build-titan.sh --install --restart")
	}
	return report
}

type cChainTip struct {
	number    uint64
	timestamp uint64
}

func fetchCChainTip(ctx context.Context, nodeURI string) (*cChainTip, error) {
	rpcURL := strings.TrimRight(nodeURI, "/") + "/ext/bc/C/rpc"
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpcURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var envelope struct {
		Result *struct {
			Number    string `json:"number"`
			Timestamp string `json:"timestamp"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode eth_getBlockByNumber: %w", err)
	}
	if envelope.Error != nil {
		return nil, fmt.Errorf("eth_getBlockByNumber: %s", envelope.Error.Message)
	}
	if envelope.Result == nil {
		return nil, fmt.Errorf("eth_getBlockByNumber returned null")
	}

	number, err := parseHexUint64(envelope.Result.Number)
	if err != nil {
		return nil, err
	}
	timestamp, err := parseHexUint64(envelope.Result.Timestamp)
	if err != nil {
		return nil, err
	}
	return &cChainTip{number: number, timestamp: timestamp}, nil
}

func parseHexUint64(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	if s == "" {
		return 0, nil
	}
	var n uint64
	if _, err := fmt.Sscanf(s, "%x", &n); err != nil {
		return 0, fmt.Errorf("parse hex %q: %w", s, err)
	}
	return n, nil
}

func expectedTreasuryEthAddr() (string, error) {
	cfg, err := loadDiskGenesisConfig()
	if err != nil {
		cfg = genesis.GetConfig(constants.TitanID)
	}
	if len(cfg.Allocations) == 0 {
		return "", fmt.Errorf("genesis has no allocations")
	}
	// First allocation is the treasury / operator prefund in genesis_titan.json.
	return "0x" + hex.EncodeToString(cfg.Allocations[0].ETHAddr.Bytes()), nil
}
