//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/vms/platformvm"
)

const (
	integrationDelegationFeePercent = 5.0
	integrationValidatorStake       = 10.0
	// Genesis validator stakes 1 TITAN (nAVAX scale). Use a small delegation that fits
	// under maxValidatorWeightFactor × validator weight.
	integrationDelegatorStake = 1.0
)

func TestIntegrationLiveNetwork(t *testing.T) {
	if os.Getenv("TITAN_INTEGRATION") != "1" {
		t.Skip("set TITAN_INTEGRATION=1 to run live node tests")
	}

	uri := strings.TrimRight(os.Getenv("TITAN_NODE_URI"), "/")
	if uri == "" {
		uri = "http://127.0.0.1:9650"
	}

	root, err := findRepoRootForTests()
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}
	titanBin := filepath.Join(root, "avalanchego", "build", "titan")
	if _, err := os.Stat(titanBin); err != nil {
		t.Fatalf("titan binary missing at %s — run build-titan.sh first", titanBin)
	}

	treasuryKey := filepath.Join(root, "docker", "integration", "treasury.key")
	delegatorKey := filepath.Join(root, "docker", "integration", "delegator.key")
	for _, p := range []string{treasuryKey, delegatorKey} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("integration key missing: %s", p)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()

	t.Run("APIAndHealth", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		healthy, err := fetchHealthBool(uri)
		if err != nil {
			t.Fatalf("health: %v", err)
		}
		if !healthy {
			t.Log("health endpoint returned healthy=false (solo node may clear after validator add)")
		}
	})

	var nodeID ids.NodeID
	t.Run("NodeID", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		infoClient := info.NewClient(uri)
		var err error
		nodeID, _, err = infoClient.GetNodeID(ctx)
		if err != nil {
			t.Fatalf("info.getNodeID: %v", err)
		}
		if nodeID == ids.EmptyNodeID {
			t.Fatal("empty NodeID")
		}
		t.Logf("NodeID: %s", nodeID)
	})

	t.Run("CtoPExportPath", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		out, err := exec.CommandContext(ctx, titanBin, "wallet", "verify-export",
			"--from", "@"+treasuryKey, "--uri", uri).CombinedOutput()
		if err != nil {
			t.Fatalf("verify-export failed: %v\n%s", err, out)
		}
		if !strings.Contains(string(out), "Export path ready") && !strings.Contains(string(out), "P-chain funded") {
			t.Fatalf("unexpected verify-export output:\n%s", out)
		}
	})

	t.Run("GenesisValidatorListed", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		vdr, ok := integrationWaitForValidator(ctx, uri, nodeID, 90*time.Second)
		if !ok {
			t.Fatalf("validator %s not found in platform.getCurrentValidators", nodeID)
		}
		if vdr.DelegationFee < integrationDelegationFeePercent-0.01 {
			t.Fatalf("delegation fee = %.2f%%, want %.2f%%", vdr.DelegationFee, integrationDelegationFeePercent)
		}
		t.Logf("validator weight=%d delegation fee=%.2f%%", vdr.Weight, vdr.DelegationFee)
	})

	t.Run("StakeAdd", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		fundOut, err := exec.CommandContext(ctx, titanBin, "wallet", "fund-p",
			"--from", "@"+delegatorKey,
			"--uri", uri,
			"--amount", fmt.Sprintf("%.0f", integrationDelegatorStake+1),
		).CombinedOutput()
		if err != nil {
			t.Fatalf("delegator fund-p failed: %v\n%s", err, fundOut)
		}
		out, err := exec.CommandContext(ctx, titanBin, "stake", "add",
			"--from", "@"+delegatorKey,
			"--node-id", nodeID.String(),
			"--uri", uri,
			"--amount", fmt.Sprintf("%.0f", integrationDelegatorStake),
		).CombinedOutput()
		if err != nil {
			t.Fatalf("stake add failed: %v\n%s", err, out)
		}
		if !strings.Contains(string(out), "Delegated!") {
			t.Fatalf("stake add output missing success:\n%s", out)
		}

		pClient := platformvm.NewClient(uri)
		validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, []ids.NodeID{nodeID})
		if err != nil || len(validators) == 0 {
			t.Fatalf("validator lookup after stake add: %v", err)
		}
		if validators[0].DelegatorWeight == nil || *validators[0].DelegatorWeight == 0 {
			t.Fatal("expected delegator weight > 0 after stake add")
		}
		t.Logf("delegator weight=%d", *validators[0].DelegatorWeight)
	})

	t.Run("StatusEnrichment", func(t *testing.T) {
		waitForAPI(t, ctx, uri)
		out, err := exec.CommandContext(ctx, titanBin, "status", uri).CombinedOutput()
		if err != nil {
			t.Fatalf("status failed: %v\n%s", err, out)
		}
		text := string(out)
		for _, want := range []string{
			nodeID.String(),
			fmt.Sprintf("delegation fee=%.2f%%", integrationDelegationFeePercent),
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("status output missing %q:\n%s", want, out)
			}
		}
	})
}

func waitForAPI(t *testing.T, ctx context.Context, uri string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		infoClient := info.NewClient(uri)
		if _, _, err := infoClient.GetNodeID(ctx); err == nil {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("API not ready: %v", ctx.Err())
		case <-time.After(3 * time.Second):
		}
	}
	t.Fatalf("API at %s not ready within timeout", uri)
}

func integrationValidatorRegistered(ctx context.Context, uri string, nodeID ids.NodeID) bool {
	_, ok := integrationWaitForValidator(ctx, uri, nodeID, 5*time.Second)
	return ok
}

func integrationWaitForValidator(ctx context.Context, uri string, nodeID ids.NodeID, timeout time.Duration) (platformvm.ClientPermissionlessValidator, bool) {
	pClient := platformvm.NewClient(uri)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, nil)
		if err == nil {
			for _, v := range validators {
				if v.NodeID == nodeID {
					return v, true
				}
			}
		}
		select {
		case <-ctx.Done():
			return platformvm.ClientPermissionlessValidator{}, false
		case <-time.After(5 * time.Second):
		}
	}
	return platformvm.ClientPermissionlessValidator{}, false
}

func fetchHealthBool(uri string) (bool, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(uri + "/ext/health")
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}
	var parsed struct {
		Healthy bool `json:"healthy"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return false, err
	}
	return parsed.Healthy, nil
}