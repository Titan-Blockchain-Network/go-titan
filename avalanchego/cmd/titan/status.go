package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm"
)

func statusMain(args []string) {
	uri := "http://127.0.0.1:9650"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		uri = strings.TrimRight(args[0], "/")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fmt.Printf("=== Titan status (%s) ===\n\n", uri)

	if ok, healthy := fetchNodeHealth(uri); !ok {
		fmt.Println("✗ Node API not reachable. Check: systemctl status titan-node")
		os.Exit(1)
	} else if healthy {
		fmt.Println("✓ healthy: true")
	} else {
		fmt.Println("! healthy: false (may clear once all validators are active)")
	}

	infoClient := info.NewClient(uri)
	nodeID, _, err := infoClient.GetNodeID(ctx)
	if err != nil {
		fmt.Printf("✗ info.getNodeID: %v\n", err)
	} else {
		fmt.Printf("✓ NodeID: %s\n", nodeID)
	}

	networkID, err := infoClient.GetNetworkID(ctx)
	if err != nil {
		fmt.Printf("! network ID: %v\n", err)
	} else if networkID == constants.TitanID {
		fmt.Printf("✓ network ID: %d (Titan)\n", networkID)
	} else {
		fmt.Printf("✗ network ID %d — expected Titan (%d)\n", networkID, constants.TitanID)
	}

	for _, chain := range []string{"P", "X", "C"} {
		synced, err := info.AwaitBootstrapped(ctx, infoClient, chain, 3*time.Second)
		switch {
		case err != nil:
			fmt.Printf("! chain %s: %v\n", chain, err)
		case synced:
			fmt.Printf("✓ chain %s bootstrapped\n", chain)
		default:
			fmt.Printf("! chain %s not bootstrapped yet\n", chain)
		}
	}

	pClient := platformvm.NewClient(uri)
	if height, err := pClient.GetHeight(ctx); err != nil {
		fmt.Printf("! P-chain height: %v\n", err)
	} else {
		fmt.Printf("✓ P-chain height: %d\n", height)
	}

	validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, nil)
	if err != nil {
		fmt.Printf("✗ platform.getCurrentValidators: %v\n", err)
	} else {
		fmt.Printf("\n--- Validators (%d) ---\n", len(validators))
		if len(validators) == 0 {
			fmt.Println("  (none yet — if you just ran validator add, wait ~5 min for start time)")
		}
		for _, v := range validators {
			fmt.Printf("  %s  weight=%.4f TITAN  start=%s  end=%s\n",
				v.NodeID,
				float64(v.Weight)/float64(units.Avax),
				time.Unix(int64(v.StartTime), 0).UTC().Format(time.RFC3339),
				time.Unix(int64(v.EndTime), 0).UTC().Format(time.RFC3339),
			)
			if v.Connected != nil {
				fmt.Printf("    connected=%v", *v.Connected)
				if v.Uptime != nil {
					fmt.Printf(" uptime=%.1f%%", formatValidatorUptime(*v.Uptime))
				}
				fmt.Println()
			}
		}
	}

	fmt.Println("\n--- Manual curl (must use POST + Content-Type) ---")
	fmt.Printf(`curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' \
  %s/ext/bc/P | jq .
`, uri)
	fmt.Println()
}

// API may return uptime as a 0–1 fraction or already as 0–100 percent.
func formatValidatorUptime(uptime float32) float64 {
	u := float64(uptime)
	if u <= 1 {
		return u * 100
	}
	return u
}

func fetchNodeHealth(uri string) (reachable bool, healthy bool) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(uri + "/ext/health")
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return true, false
	}
	var parsed struct {
		Healthy bool `json:"healthy"`
	}
	if json.Unmarshal(body, &parsed) != nil {
		return true, false
	}
	return true, parsed.Healthy
}