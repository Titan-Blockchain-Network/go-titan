package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/ids"
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

	if snap.networkID != constants.TitanID {
		fmt.Printf("  ✗ network ID %d is not Titan (%d)\n", snap.networkID, constants.TitanID)
		report.ok = false
	} else {
		fmt.Printf("  ✓ network ID %d\n", snap.networkID)
	}

	fmt.Printf("  ✓ C-chain ID %s\n", snap.cChainID)
	fmt.Printf("  ✓ P-chain staking asset %s\n", snap.pStakingID)

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
		fmt.Println("  ✗ Export path checks failed — fix issues above, then: git pull && ./scripts/build-titan.sh")
	}
	return report
}

func expectedTreasuryEthAddr() (string, error) {
	cfg := genesis.GetConfig(constants.TitanID)
	if len(cfg.Allocations) == 0 {
		return "", fmt.Errorf("genesis has no allocations")
	}
	// First allocation is the treasury / operator prefund in genesis_titan.json.
	return "0x" + hex.EncodeToString(cfg.Allocations[0].ETHAddr.Bytes()), nil
}