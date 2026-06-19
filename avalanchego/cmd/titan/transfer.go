package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/upgrade"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/vms/avm"
	"github.com/ava-labs/avalanchego/vms/platformvm"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/chain/c"
	"github.com/ava-labs/avalanchego/wallet/chain/p/wallet"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary/common"
)

const (
	transferImportMaxAttempts = 30
	transferImportPollDelay   = 2 * time.Second
	// Titan genesis dynamic-fee MinPrice (nAVAX wei); safe fallback if eth_baseFee is missing.
	transferDefaultBaseFeeWei = 250
)

// fetchEthBaseFee queries eth_baseFee and tolerates nodes that return a JSON number
// instead of a 0x-prefixed hex string (coreth ethclient expects the string form).
func fetchEthBaseFee(ctx context.Context, nodeURI string) (*big.Int, error) {
	rpcURL := strings.TrimRight(nodeURI, "/") + "/ext/bc/C/rpc"
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_baseFee","params":[]}`)
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
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode eth_baseFee response: %w", err)
	}
	if envelope.Error != nil {
		return nil, fmt.Errorf("eth_baseFee RPC error: %s", envelope.Error.Message)
	}
	if len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		return big.NewInt(transferDefaultBaseFeeWei), nil
	}

	var asString string
	if err := json.Unmarshal(envelope.Result, &asString); err == nil {
		asString = strings.TrimSpace(asString)
		if asString == "" || asString == "0x" {
			return big.NewInt(transferDefaultBaseFeeWei), nil
		}
		n, ok := new(big.Int).SetString(strings.TrimPrefix(asString, "0x"), 16)
		if !ok {
			n, ok = new(big.Int).SetString(asString, 10)
		}
		if !ok {
			return nil, fmt.Errorf("parse eth_baseFee string %q", asString)
		}
		return n, nil
	}

	var asNumber json.Number
	if err := json.Unmarshal(envelope.Result, &asNumber); err == nil {
		n, ok := new(big.Int).SetString(asNumber.String(), 10)
		if !ok {
			return nil, fmt.Errorf("parse eth_baseFee number %q", asNumber)
		}
		return n, nil
	}

	var asUint uint64
	if err := json.Unmarshal(envelope.Result, &asUint); err == nil {
		return new(big.Int).SetUint64(asUint), nil
	}
	return nil, fmt.Errorf("unsupported eth_baseFee result: %s", string(envelope.Result))
}

type chainAssetSnapshot struct {
	networkID    uint32
	cChainID     ids.ID
	pStakingID   ids.ID
	xAvaxAliasID ids.ID
}

func fetchChainAssetSnapshot(ctx context.Context, nodeURI string) (*chainAssetSnapshot, error) {
	uri := strings.TrimRight(nodeURI, "/")
	infoClient := info.NewClient(uri)
	pClient := platformvm.NewClient(uri)
	xClient := avm.NewClient(uri, "X")

	networkID, err := infoClient.GetNetworkID(ctx)
	if err != nil {
		return nil, err
	}
	cChainID, err := infoClient.GetBlockchainID(ctx, "C")
	if err != nil {
		return nil, err
	}
	pStakingID, err := pClient.GetStakingAssetID(ctx, constants.PrimaryNetworkID)
	if err != nil {
		return nil, err
	}

	snap := &chainAssetSnapshot{
		networkID:  networkID,
		cChainID:   cChainID,
		pStakingID: pStakingID,
	}
	if xAsset, err := xClient.GetAssetDescription(ctx, "AVAX"); err == nil {
		snap.xAvaxAliasID = xAsset.AssetID
	}
	return snap, nil
}

// transferCToP moves TITAN from C-chain to P-chain, retrying import until the
// exported atomic UTXO is visible on the P-chain.
func transferCToP(
	ctx context.Context,
	nodeURI string,
	cw c.Wallet,
	pw wallet.Wallet,
	amount uint64,
	owner *secp256k1fx.OutputOwners,
) error {
	fmt.Printf("Moving %.0f TITAN C→P...\n", float64(amount)/1e9)

	baseFee, err := fetchEthBaseFee(ctx, nodeURI)
	if err != nil {
		fmt.Printf("  Warning: eth_baseFee unavailable (%v); using %d wei\n", err, transferDefaultBaseFeeWei)
		baseFee = big.NewInt(transferDefaultBaseFeeWei)
	}

	walletCtx := cw.Builder().Context()
	cChainID := walletCtx.BlockchainID
	avaxAssetID := walletCtx.AVAXAssetID
	fmt.Printf("  C-chain ID %s, staking asset %s → P-chain\n", cChainID, avaxAssetID)

	if snap, err := fetchChainAssetSnapshot(ctx, nodeURI); err == nil {
		if snap.cChainID != cChainID {
			fmt.Printf("  Warning: wallet C-chain ID %s != node %s\n", cChainID, snap.cChainID)
		}
		if snap.pStakingID != avaxAssetID {
			fmt.Printf("  Warning: wallet asset %s != P-chain staking asset %s\n", avaxAssetID, snap.pStakingID)
		}
		if snap.xAvaxAliasID != ids.Empty && snap.xAvaxAliasID != snap.pStakingID {
			fmt.Printf("  Note: X-chain AVAX alias %s differs from staking asset %s (wallet uses staking asset)\n",
				snap.xAvaxAliasID, snap.pStakingID)
		}
	}

	exp, err := cw.IssueExportTx(
		constants.PlatformChainID,
		[]*secp256k1fx.TransferOutput{{Amt: amount, OutputOwners: *owner}},
		common.WithBaseFee(baseFee),
	)
	if err != nil {
		hint := "run: titan wallet verify-export --from @master.key"
		if tip, tipErr := fetchCChainTip(ctx, nodeURI); tipErr == nil {
			up := upgrade.GetConfig(walletCtx.NetworkID)
			if !up.IsApricotPhase5Activated(time.Unix(int64(tip.timestamp), 0)) {
				hint = fmt.Sprintf(
					"C-chain tip timestamp %d is before AP5 (%s) — rebuild titan-node with Titan upgrade config: git pull && ./scripts/build-titan.sh && sudo systemctl restart titan-node",
					tip.timestamp,
					up.ApricotPhase5Time.UTC().Format(time.RFC3339),
				)
			}
		}
		return fmt.Errorf(
			"export: %w (network=%d C-chain=%s asset=%s — %s)",
			err, walletCtx.NetworkID, cChainID, avaxAssetID, hint,
		)
	}
	fmt.Printf("export %s (accepted)\n", exp.ID())

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