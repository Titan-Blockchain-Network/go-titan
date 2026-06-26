package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm"
	"github.com/ava-labs/avalanchego/vms/platformvm/txs"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

func delegatorMain(args []string) {
	if len(args) == 0 || args[0] != "add" {
		fmt.Fprintln(os.Stderr, "usage: titan delegator add --from @wallet.key --node-id NodeID-... [--amount 100] [--uri http://127.0.0.1:9650]")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("delegator add", flag.ExitOnError)
	from := fs.String("from", "", "staker private key hex or @file (required)")
	nodeIDFlag := fs.String("node-id", "", "validator NodeID to delegate to (required)")
	amount := fs.Float64("amount", 100, "tokens to stake as delegator")
	uri := fs.String("uri", "http://127.0.0.1:9650", "node API for wallet txs")
	fs.Parse(args[1:])

	if *from == "" || *nodeIDFlag == "" {
		fmt.Fprintln(os.Stderr, "--from and --node-id are required")
		os.Exit(1)
	}
	if *amount < 1 {
		fmt.Fprintln(os.Stderr, "stake must be at least 1 token")
		os.Exit(1)
	}

	priv, err := loadKey(*from)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bad key: %v\n", err)
		os.Exit(1)
	}

	targetNodeID, err := ids.NodeIDFromString(*nodeIDFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid node-id: %v\n", err)
		os.Exit(1)
	}

	ctx := context.Background()
	kc := secp256k1fx.NewKeychain(priv)
	w, err := primary.MakeWallet(ctx, *uri, kc, kc, primary.WalletConfig{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "wallet connect failed: %v\n", err)
		os.Exit(1)
	}

	pClient := platformvm.NewClient(*uri)
	validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, []ids.NodeID{targetNodeID})
	if err != nil || len(validators) == 0 {
		fmt.Fprintf(os.Stderr, "validator %s not found or not active — run: titan status\n", targetNodeID)
		os.Exit(1)
	}
	vdr := validators[0]
	now := time.Now().Unix()
	if int64(vdr.EndTime) <= now+300 {
		fmt.Fprintf(os.Stderr, "validator ends too soon (%s)\n", time.Unix(int64(vdr.EndTime), 0).UTC())
		os.Exit(1)
	}

	stakeAmt := uint64(*amount * float64(units.Avax))
	addr := priv.Address()
	rewardsOwner := &secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{addr}}

	fmt.Printf("Delegating %.0f tokens to validator %s (ends %s)...\n",
		*amount, targetNodeID,
		time.Unix(int64(vdr.EndTime), 0).UTC().Format(time.RFC3339))

	pw := w.P()
	tx, err := pw.IssueAddPermissionlessDelegatorTx(
		&txs.SubnetValidator{
			Validator: txs.Validator{
				NodeID: targetNodeID,
				Start:  vdr.StartTime,
				End:    vdr.EndTime,
				Wght:   stakeAmt,
			},
			Subnet: constants.PrimaryNetworkID,
		},
		pw.Builder().Context().AVAXAssetID,
		rewardsOwner,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "delegation failed: %v\n", err)
		fmt.Fprintln(os.Stderr, "Ensure P-chain has enough balance (titan wallet balances --from ...)")
		os.Exit(1)
	}

	fmt.Printf("\nDelegated! tx = %s\n", tx.ID())
	fmt.Println("Rewards accrue to your P-chain address for the delegation period.")
	fmt.Println("Validators earn delegation fees; delegators earn staking rewards.")
}

func stakeMain(args []string) {
	// alias: titan stake add → titan delegator add
	if len(args) > 0 && args[0] == "add" {
		delegatorMain(append([]string{"add"}, args[1:]...))
		return
	}
	fmt.Fprintln(os.Stderr, "usage: titan stake add --from @wallet.key --node-id NodeID-...")
	os.Exit(1)
}