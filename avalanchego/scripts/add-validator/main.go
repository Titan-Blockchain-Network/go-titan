// Copyright (C) 2019-2025, Ava Labs, Inc. All rights reserved.
// See the file LICENSE for licensing terms.

// add-validator issues an AddPermissionlessValidatorTx on the primary network (P-chain)
// using a funded P-chain private key (the same one used for C->P transfer).
//
// Prerequisites:
//   - The P address derived from --privkey must have sufficient unlocked balance (after import from C)
//   - The target node (the one becoming validator) must be running and you have its NodeID + BLS POP
//     (obtain with: curl .../ext/info  info.getNodeID)
//
// Usage (example):
//   cd avalanchego
//   go run ./scripts/add-validator \
//     --privkey=... \
//     --node-id=NodeID-xxx \
//     --bls-pubkey=0x... \
//     --bls-pop=0x... \
//     --weight=2000000 \
//     --start-offset-min=2 \
//     --duration-days=14 \
//     --uri=http://127.0.0.1:9650
//
// The reward owners default to the same address as the staker key.

package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/formatting/address"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
	"github.com/ava-labs/avalanchego/vms/platformvm/txs"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

func main() {
	privkey := flag.String("privkey", "", "32-byte secp256k1 private key hex controlling P funds")
	uri := flag.String("uri", "http://127.0.0.1:9650", "node API uri")
	nodeIDStr := flag.String("node-id", "", "NodeID-... of the validator to register (from info.getNodeID on target node)")
	blsPubHex := flag.String("bls-pubkey", "", "BLS public key hex (0x...) from info.getNodeID")
	blsPopHex := flag.String("bls-pop", "", "BLS proofOfPossession hex (0x...) from info.getNodeID")
	weightWhole := flag.Float64("weight", 2_000_000, "Stake weight in whole TITAN units")
	startOffsetMin := flag.Int("start-offset-min", 2, "Start time offset from now in minutes (must be in future)")
	durationDays := flag.Int("duration-days", 14, "Staking duration in days")
	rewardAddrStr := flag.String("reward-addr", "", "Optional P-titan... reward address (defaults to key's P address)")
	delegationFee := flag.Uint("delegation-fee", uint(reward.PercentDenominator/4), "Delegation fee in basis points (10000 = 100%)")
	flag.Parse()

	if *privkey == "" || *nodeIDStr == "" || *blsPubHex == "" || *blsPopHex == "" {
		log.Fatal("required: --privkey --node-id --bls-pubkey --bls-pop")
	}

	hexStr := strings.TrimPrefix(*privkey, "0x")
	privBytes, err := hex.DecodeString(hexStr)
	if err != nil || len(privBytes) != 32 {
		log.Fatalf("bad privkey: %v", err)
	}
	key, err := secp256k1.ToPrivateKey(privBytes)
	if err != nil {
		log.Fatalf("parse key: %s", err)
	}
	avaxAddr := key.Address()

	pAddr, _ := address.Format("P", "titan", avaxAddr[:])
	rewardAddr := avaxAddr
	if *rewardAddrStr != "" {
		raw := *rewardAddrStr
		if idx := strings.LastIndex(raw, "-"); idx != -1 {
			raw = raw[idx+1:]
		}
		_, rewardBytes, err := address.ParseBech32(raw)
		if err != nil {
			log.Printf("warning parsing --reward-addr, using key default: %s", err)
		} else if len(rewardBytes) == len(avaxAddr) {
			copy(rewardAddr[:], rewardBytes)
		}
	}

	nodeID, err := ids.NodeIDFromString(*nodeIDStr)
	if err != nil {
		log.Fatalf("bad --node-id: %s", err)
	}

	pubBytes, err := hex.DecodeString(strings.TrimPrefix(*blsPubHex, "0x"))
	if err != nil {
		log.Fatalf("bad bls-pubkey: %s", err)
	}
	popBytes, err := hex.DecodeString(strings.TrimPrefix(*blsPopHex, "0x"))
	if err != nil {
		log.Fatalf("bad bls-pop: %s", err)
	}

	pop := &signer.ProofOfPossession{}
	if len(pubBytes) != len(pop.PublicKey) {
		log.Fatalf("bls pubkey wrong length: got %d want %d", len(pubBytes), len(pop.PublicKey))
	}
	if len(popBytes) != len(pop.ProofOfPossession) {
		log.Fatalf("bls pop wrong length: got %d want %d", len(popBytes), len(pop.ProofOfPossession))
	}
	copy(pop.PublicKey[:], pubBytes)
	copy(pop.ProofOfPossession[:], popBytes)

	weight := uint64(*weightWhole * float64(units.Avax))
	if weight < 1*units.Avax {
		log.Fatalf("weight too small (min 1 TITAN unit)")
	}

	startTime := time.Now().Add(time.Duration(*startOffsetMin) * time.Minute).UTC()
	endTime := startTime.Add(time.Duration(*durationDays) * 24 * time.Hour)

	fmt.Printf("Adding validator:\n")
	fmt.Printf("  NodeID:     %s\n", nodeID)
	fmt.Printf("  From addr:  %s\n", pAddr)
	fmt.Printf("  Weight:     %f TITAN\n", *weightWhole)
	fmt.Printf("  Start:      %s (unix %d)\n", startTime, startTime.Unix())
	fmt.Printf("  End:        %s (unix %d)\n", endTime, endTime.Unix())
	fmt.Printf("  Delegation fee: %d / 10000\n\n", *delegationFee)

	ctx := context.Background()

	// We only need the P wallet for adding validator (funds must already be on P)
	walletStart := time.Now()
	pWalletIface, err := primary.MakePWallet(
		ctx,
		*uri,
		secp256k1fx.NewKeychain(key),
		primary.WalletConfig{},
	)
	if err != nil {
		log.Fatalf("failed to init P wallet (does the address have P balance?): %s", err)
	}
	fmt.Printf("P wallet synced in %s\n", time.Since(walletStart))

	chainCtx := pWalletIface.Builder().Context()
	avaxAssetID := chainCtx.AVAXAssetID

	validator := &txs.SubnetValidator{
		Validator: txs.Validator{
			NodeID: nodeID,
			Start:  uint64(startTime.Unix()),
			End:    uint64(endTime.Unix()),
			Wght:   weight,
		},
		// SubnetID is omitted for primary network (defaults inside)
	}

	addStart := time.Now()
	addTx, err := pWalletIface.IssueAddPermissionlessValidatorTx(
		validator,
		pop,
		avaxAssetID,
		&secp256k1fx.OutputOwners{
			Threshold: 1,
			Addrs:     []ids.ShortID{rewardAddr},
		},
		&secp256k1fx.OutputOwners{
			Threshold: 1,
			Addrs:     []ids.ShortID{rewardAddr},
		},
		uint32(*delegationFee),
	)
	if err != nil {
		log.Fatalf("failed to issue addPermissionlessValidator: %s", err)
	}
	fmt.Printf("SUCCESS: addPermissionlessValidator txID=%s (issued in %s)\n", addTx.ID(), time.Since(addStart))
	fmt.Printf("\nCheck status with:\n")
	fmt.Printf("  curl -s -X POST -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"platform.getCurrentValidators\"}' %s/ext/bc/P | cat\n", *uri)

	_ = info.NewClient // imported for completeness if future fetch needed
	_ = reward.PercentDenominator
}
