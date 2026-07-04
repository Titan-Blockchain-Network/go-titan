//go:build integration

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/vms/platformvm"
)

// TestE2EFourValidatorNetwork asserts a bootstrap + 3 provider deployment:
// genesis validator on bootstrap plus three permissionless onboard txs.
func TestE2EFourValidatorNetwork(t *testing.T) {
	if os.Getenv("TITAN_E2E") != "1" {
		t.Skip("set TITAN_E2E=1 (run via scripts/e2e-four-validators.sh)")
	}

	wantCount, _ := strconv.Atoi(os.Getenv("TITAN_E2E_VALIDATOR_COUNT"))
	if wantCount <= 0 {
		wantCount = 4
	}

	bootstrapURI := strings.TrimRight(os.Getenv("TITAN_E2E_BOOTSTRAP_URI"), "/")
	if bootstrapURI == "" {
		bootstrapURI = "http://127.0.0.1:9650"
	}

	providerURIs := strings.Split(os.Getenv("TITAN_E2E_PROVIDER_URIS"), ",")
	for i := range providerURIs {
		providerURIs[i] = strings.TrimSpace(providerURIs[i])
	}
	if len(providerURIs) < 3 || providerURIs[0] == "" {
		t.Fatalf("TITAN_E2E_PROVIDER_URIS must list 3 provider API URLs")
	}

	root, err := findRepoRootForTests()
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}
	titanBin := filepath.Join(root, "avalanchego", "build", "titan")
	delegatorKey := filepath.Join(root, "docker", "integration", "delegator.key")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	infoClient := info.NewClient(bootstrapURI)
	bootstrapID, _, err := infoClient.GetNodeID(ctx)
	if err != nil {
		t.Fatalf("bootstrap getNodeID: %v", err)
	}

	providerIDs := make([]ids.NodeID, 0, len(providerURIs))
	for _, uri := range providerURIs {
		c := info.NewClient(uri)
		id, _, err := c.GetNodeID(ctx)
		if err != nil {
			t.Fatalf("provider %s getNodeID: %v", uri, err)
		}
		providerIDs = append(providerIDs, id)
		t.Logf("provider %s → %s", uri, id)
	}

	wantIDs := append([]ids.NodeID{bootstrapID}, providerIDs...)

	t.Run("FourValidatorsOnChain", func(t *testing.T) {
		validators, ok := e2eWaitForValidatorCount(ctx, bootstrapURI, wantCount, 4*time.Minute)
		if !ok {
			t.Fatalf("expected %d validators, got %d", wantCount, len(validators))
		}
		seen := make(map[ids.NodeID]platformvm.ClientPermissionlessValidator)
		for _, v := range validators {
			seen[v.NodeID] = v
		}
		for _, id := range wantIDs {
			v, ok := seen[id]
			if !ok {
				t.Fatalf("missing validator %s in platform.getCurrentValidators", id)
			}
			if v.DelegationFee < integrationDelegationFeePercent-0.5 {
				t.Fatalf("validator %s delegation fee %.2f%% < %.2f%%", id, v.DelegationFee, integrationDelegationFeePercent)
			}
		}
		t.Logf("on-chain validators: %d", len(validators))
	})

	t.Run("ProviderOnboardPath", func(t *testing.T) {
		// Bootstrap genesis validator + each provider onboarded via treasury C→P path.
		pClient := platformvm.NewClient(bootstrapURI)
		validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, providerIDs)
		if err != nil {
			t.Fatalf("getCurrentValidators: %v", err)
		}
		if len(validators) != len(providerIDs) {
			t.Fatalf("provider validators = %d, want %d", len(validators), len(providerIDs))
		}
	})

	t.Run("DelegatorStakeAdd", func(t *testing.T) {
		target := providerIDs[0]
		out, err := exec.CommandContext(ctx, titanBin, "stake", "add",
			"--from", "@"+delegatorKey,
			"--node-id", target.String(),
			"--uri", bootstrapURI,
			"--amount", fmt.Sprintf("%.0f", integrationDelegatorStake),
		).CombinedOutput()
		if err != nil {
			t.Fatalf("stake add: %v\n%s", err, out)
		}
		if !strings.Contains(string(out), "Delegated!") {
			t.Fatalf("stake add output:\n%s", out)
		}

		pClient := platformvm.NewClient(bootstrapURI)
		validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, []ids.NodeID{target})
		if err != nil || len(validators) == 0 {
			t.Fatalf("validator lookup: %v", err)
		}
		if validators[0].DelegatorWeight == nil || *validators[0].DelegatorWeight == 0 {
			t.Fatal("expected delegator weight > 0")
		}
	})

	t.Run("StatusShowsNetwork", func(t *testing.T) {
		out, err := exec.CommandContext(ctx, titanBin, "status", bootstrapURI).CombinedOutput()
		if err != nil {
			t.Fatalf("status: %v\n%s", err, out)
		}
		text := string(out)
		if !strings.Contains(text, fmt.Sprintf("--- Validators (%d) ---", wantCount)) {
			for _, id := range wantIDs {
				if !strings.Contains(text, id.String()) {
					t.Fatalf("status missing %s:\n%s", id, out)
				}
			}
		}
	})
}

func e2eWaitForValidatorCount(ctx context.Context, uri string, want int, timeout time.Duration) ([]platformvm.ClientPermissionlessValidator, bool) {
	pClient := platformvm.NewClient(uri)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		validators, err := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, nil)
		if err == nil && len(validators) >= want {
			return validators, true
		}
		select {
		case <-ctx.Done():
			return nil, false
		case <-time.After(5 * time.Second):
		}
	}
	validators, _ := pClient.GetCurrentValidators(ctx, constants.PrimaryNetworkID, nil)
	return validators, false
}