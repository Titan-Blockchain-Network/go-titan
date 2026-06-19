package main

import (
	"context"
	"fmt"
	"time"

	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/chain/c"
	"github.com/ava-labs/avalanchego/wallet/chain/p/wallet"
)

const (
	transferImportMaxAttempts = 30
	transferImportPollDelay   = 2 * time.Second
)

// transferCToP moves TITAN from C-chain to P-chain, retrying import until the
// exported atomic UTXO is visible on the P-chain.
func transferCToP(
	ctx context.Context,
	cw c.Wallet,
	pw wallet.Wallet,
	amount uint64,
	owner *secp256k1fx.OutputOwners,
) error {
	fmt.Printf("Moving %.0f TITAN C→P...\n", float64(amount)/1e9)

	exp, err := cw.IssueExportTx(
		constants.PlatformChainID,
		[]*secp256k1fx.TransferOutput{{Amt: amount, OutputOwners: *owner}},
	)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	fmt.Printf("export %s (accepted)\n", exp.ID())

	cChainID := cw.Builder().Context().BlockchainID
	var lastErr error
	for attempt := 1; attempt <= transferImportMaxAttempts; attempt++ {
		imp, err := pw.IssueImportTx(cChainID, owner)
		if err == nil {
			fmt.Printf("import %s (attempt %d)\n", imp.ID(), attempt)
			return nil
		}
		lastErr = err
		if attempt < transferImportMaxAttempts {
			fmt.Printf("  import not ready (attempt %d/%d): %v — retrying...\n",
				attempt, transferImportMaxAttempts, err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(transferImportPollDelay):
			}
		}
	}
	return fmt.Errorf("import failed after %d attempts: %w", transferImportMaxAttempts, lastErr)
}