// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

// transfer-c-to-p moves TITAN from the C-Chain to the P-Chain using a raw private key (hex).
// This replaces the deprecated keystore + avax.export flow.
//
// Usage (on a node with API access and Go toolchain):
//   cd avalanchego
//   go run ./scripts/transfer-c-to-p \
//     --privkey=YOUR_HEX_PRIVKEY_FROM_METAMASK \
//     --amount=2000000 \
//     --uri=http://127.0.0.1:9650
//
// After success, the P-balance for the corresponding P-titan1... address will be increased.
// Then use the same privkey + the target node's info.getNodeID output to issue addPermissionlessValidator.
//
// The private key controls BOTH the C address (0x...) and the matching P/X address (P-titan1... / X-titan1...).

package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/formatting/address"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/txs"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

func main() {
	privkey := flag.String("privkey", "", "32-byte secp256k1 private key in hex (from MetaMask, 0x prefix optional)")
	uri := flag.String("uri", "http://127.0.0.1:9650", "AvalancheGo HTTP API base URI")
	amountWhole := flag.Float64("amount", 2_000_000, "Amount of TITAN (whole units, 18 decimals) to move from C to P")
	flag.Parse()

	if *privkey == "" {
		log.Fatal("--privkey is required (export from MetaMask for the 0x1b37... address)")
	}

	hexStr := strings.TrimPrefix(strings.TrimSpace(*privkey), "0x")
	hexStr = strings.TrimPrefix(hexStr, "0X")
	privBytes, err := hex.DecodeString(hexStr)
	if err != nil || len(privBytes) != 32 {
		log.Fatalf("invalid --privkey: must be 64 hex characters (got %d bytes after decode): %v", len(privBytes), err)
	}

	key, err := secp256k1.ToPrivateKey(privBytes)
	if err != nil {
		log.Fatalf("failed to parse private key: %s", err)
	}

	avaxAddr := key.Address()
	ethAddr := key.PublicKey().EthAddress()

	amount := uint64(*amountWhole * float64(units.Avax))
	if amount == 0 {
		log.Fatal("amount must be > 0")
	}

	pAddr, err := address.Format("P", "titan", avaxAddr[:])
	if err != nil {
		log.Fatalf("failed to format P address: %s", err)
	}
	xAddr, err := address.Format("X", "titan", avaxAddr[:])
	if err != nil {
		log.Fatalf("failed to format X address: %s", err)
	}

	fmt.Printf("Key derived addresses:\n")
	fmt.Printf("  C-Chain (eth): %s\n", ethAddr.Hex())
	fmt.Printf("  P-Chain:       %s\n", pAddr)
	fmt.Printf("  X-Chain:       %s\n", xAddr)
	fmt.Printf("Amount to export from C->P: %f TITAN (%d units)\n\n", *amountWhole, amount)

	ctx := context.Background()

	walletStart := time.Now()
	wallet, err := primary.MakeWallet(
		ctx,
		*uri,
		secp256k1fx.NewKeychain(key),
		secp256k1fx.NewKeychain(key),
		primary.WalletConfig{},
	)
	if err != nil {
		log.Fatalf("failed to initialize wallet (is the node running and funded on C?): %s", err)
	}
	fmt.Printf("wallet synced in %s\n", time.Since(walletStart))

	cWallet := wallet.C()
	pWallet := wallet.P()

	cCtx := cWallet.Builder().Context()
	cChainID := cCtx.BlockchainID
	avaxAssetID := cCtx.AVAXAssetID

	owner := secp256k1fx.OutputOwners{
		Threshold: 1,
		Addrs:     []ids.ShortID{avaxAddr},
	}

	fmt.Printf("Issuing C-Chain export to P-Chain...\n")
	exportStart := time.Now()
	exportTx, err := cWallet.IssueExportTx(
		constants.PlatformChainID,
		[]*secp256k1fx.TransferOutput{{
			Amt:          amount,
			OutputOwners: owner,
		}},
	)
	if err != nil {
		log.Fatalf("C export failed: %s", err)
	}
	fmt.Printf("  export txID: %s (took %s)\n", exportTx.ID(), time.Since(exportStart))

	fmt.Printf("Issuing P-Chain import from C-Chain (retrying until atomic UTXO is visible)...\n")
	const maxAttempts = 30
	var importTx *txs.Tx
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		importStart := time.Now()
		importTx, lastErr = pWallet.IssueImportTx(cChainID, &owner)
		if lastErr == nil {
			fmt.Printf("  import txID: %s (attempt %d, took %s)\n", importTx.ID(), attempt, time.Since(importStart))
			break
		}
		if attempt < maxAttempts {
			fmt.Printf("  import not ready (attempt %d/%d): %v — retrying...\n", attempt, maxAttempts, lastErr)
			time.Sleep(2 * time.Second)
		}
	}
	if lastErr != nil {
		log.Fatalf("P import failed after %d attempts: %s", maxAttempts, lastErr)
	}

	fmt.Printf("\nSuccess. C->P transfer complete.\n")
	fmt.Printf("Use the P address %s for staking (addPermissionlessValidator).\n", pAddr)

	// Optional: print rough current P balance using the builder
	fmt.Printf("\nTo verify balance, run on the node:\n")
	fmt.Printf("  curl -s -X POST --data '{\n")
	fmt.Printf("    \"jsonrpc\":\"2.0\",\"id\":1,\n")
	fmt.Printf("    \"method\":\"platform.getBalance\",\n")
	fmt.Printf("    \"params\":{\"addresses\":[\"%s\"]}\n", pAddr)
	fmt.Printf("  }' -H 'content-type:application/json' %s/ext/bc/P | cat\n", *uri)
	_ = avaxAssetID // used indirectly
	_ = big.NewInt // not needed, but keep for possible future
}
