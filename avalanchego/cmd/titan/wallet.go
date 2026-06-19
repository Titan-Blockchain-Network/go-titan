package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/formatting/address"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

type chainAddresses struct {
	C string
	P string
	X string
}

func deriveChainAddresses(priv *secp256k1.PrivateKey) (chainAddresses, error) {
	hrp := constants.GetHRP(constants.TitanID)
	shortID := priv.Address()
	p, err := address.Format("P", hrp, shortID.Bytes())
	if err != nil {
		return chainAddresses{}, err
	}
	x, err := address.Format("X", hrp, shortID.Bytes())
	if err != nil {
		return chainAddresses{}, err
	}
	return chainAddresses{
		C: priv.PublicKey().EthAddress().Hex(),
		P: p,
		X: x,
	}, nil
}

func walletMain(args []string) {
	if len(args) == 0 {
		fmt.Println(`titan wallet - one key, all chains

  titan wallet addresses --from @master.key   # show C / P / X addresses for a private key
  titan wallet balances  --from @master.key --uri http://127.0.0.1:9650
  titan wallet verify-export [--from @/root/master.key] [--uri http://127.0.0.1:9650]`)
		return
	}

	switch args[0] {
	case "addresses":
		walletAddressesMain(args[1:])
	case "balances":
		walletBalancesMain(args[1:])
	case "verify-export":
		walletVerifyExportMain(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown wallet subcommand: %s\n", args[0])
		os.Exit(1)
	}
}

func walletVerifyExportMain(args []string) {
	fs := flag.NewFlagSet("wallet verify-export", flag.ExitOnError)
	uri := fs.String("uri", "http://127.0.0.1:9650", "local node API")
	from := fs.String("from", "@"+defaultMasterKeyPath, "treasury key @file path")
	fs.Parse(args)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	masterPath := strings.TrimPrefix(strings.TrimSpace(*from), "@")

	fmt.Printf("Verifying C→P export path against %s\n\n", *uri)
	report := verifyExportPath(ctx, *uri, masterPath)
	if !report.ok {
		os.Exit(1)
	}
}

func walletAddressesMain(args []string) {
	fs := flag.NewFlagSet("wallet addresses", flag.ExitOnError)
	from := fs.String("from", "", "private key hex or @file (required)")
	fs.Parse(args)

	if *from == "" {
		fmt.Fprintln(os.Stderr, "--from is required")
		os.Exit(1)
	}
	priv, err := loadKey(*from)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bad key: %v\n", err)
		os.Exit(1)
	}
	addrs, err := deriveChainAddresses(priv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "derive addresses: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("One private key controls all three chain addresses:")
	fmt.Printf("  C-Chain (EVM):  %s\n", addrs.C)
	fmt.Printf("  P-Chain:        %s\n", addrs.P)
	fmt.Printf("  X-Chain:        %s\n", addrs.X)
	fmt.Println()
	fmt.Println("Import this key in MetaMask (or any EVM wallet) using the same hex private key.")
	fmt.Println("Use 'titan wallet balances --from ... --uri http://NODE:9650' to check funded balances.")
}

func walletBalancesMain(args []string) {
	fs := flag.NewFlagSet("wallet balances", flag.ExitOnError)
	from := fs.String("from", "", "private key hex or @file (required)")
	uri := fs.String("uri", "http://127.0.0.1:9650", "node API")
	fs.Parse(args)

	if *from == "" {
		fmt.Fprintln(os.Stderr, "--from is required")
		os.Exit(1)
	}
	priv, err := loadKey(*from)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bad key: %v\n", err)
		os.Exit(1)
	}
	addrs, err := deriveChainAddresses(priv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "derive addresses: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Balances for %s\n\n", addrs.C)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cBal, cErr := queryCChainBalance(ctx, *uri, addrs.C)
	if cErr != nil {
		fmt.Printf("  C-Chain: error — %v\n", cErr)
	} else {
		fmt.Printf("  C-Chain: %s TITAN\n", formatHumanTitan(cBal, 18))
	}

	kc := secp256k1fx.NewKeychain(priv)
	w, err := primary.MakeWallet(ctx, *uri, kc, kc, primary.WalletConfig{})
	if err != nil {
		fmt.Printf("  P-Chain: error — wallet connect: %v\n", err)
		fmt.Printf("  X-Chain: error — wallet connect: %v\n", err)
		return
	}

	pCtx := w.P().Builder().Context()
	pBalMap, pErr := w.P().Builder().GetBalance()
	if pErr != nil {
		fmt.Printf("  P-Chain (%s): error — %v\n", addrs.P, pErr)
	} else {
		fmt.Printf("  P-Chain (%s): %s TITAN (spendable)\n", addrs.P, formatNanoTitan(pBalMap[pCtx.AVAXAssetID]))
	}

	xCtx := w.X().Builder().Context()
	xBalMap, xErr := w.X().Builder().GetFTBalance()
	if xErr != nil {
		fmt.Printf("  X-Chain (%s): error — %v\n", addrs.X, xErr)
	} else {
		fmt.Printf("  X-Chain (%s): %s TITAN (spendable)\n", addrs.X, formatNanoTitan(xBalMap[xCtx.AVAXAssetID]))
	}
}

func formatNanoTitan(amount uint64) string {
	return fmt.Sprintf("%.9f", float64(amount)/float64(units.Avax))
}

func formatHumanTitan(wei *big.Int, decimals int) string {
	if wei == nil {
		return "0"
	}
	f := new(big.Float).SetInt(wei)
	denom := new(big.Float).SetFloat64(1)
	for i := 0; i < decimals; i++ {
		denom.Mul(denom, big.NewFloat(10))
	}
	f.Quo(f, denom)
	return f.Text('f', 4)
}

func queryCChainBalance(ctx context.Context, uri, ethAddr string) (*big.Int, error) {
	payload := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["%s","latest"]}`, ethAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(uri, "/")+"/ext/bc/C/rpc", strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var result struct {
		Result string `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if result.Error != nil {
		return nil, fmt.Errorf("%s", result.Error.Message)
	}
	return parseHexBigInt(result.Result)
}

func parseHexBigInt(hexStr string) (*big.Int, error) {
	hexStr = strings.TrimPrefix(strings.TrimSpace(hexStr), "0x")
	if hexStr == "" {
		return big.NewInt(0), nil
	}
	n := new(big.Int)
	if _, ok := n.SetString(hexStr, 16); !ok {
		return nil, fmt.Errorf("invalid hex: %s", hexStr)
	}
	return n, nil
}