// titan - friendly CLI for operating the Titan blockchain.
//
// Build:
//   cd avalanchego
//   go build -o build/titan ./cmd/titan
//
// This gives operators a much better experience than raw avalanchego +
// manual hex private keys + many curls.

package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/units"
	"github.com/ava-labs/avalanchego/vms/platformvm/reward"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
	"github.com/ava-labs/avalanchego/vms/platformvm/txs"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		return
	}

	switch os.Args[1] {
	case "keys":
		keysMain(os.Args[2:])
	case "genesis":
		genesisMain(os.Args[2:])
	case "wallet":
		walletMain(os.Args[2:])
	case "validator":
		validatorMain(os.Args[2:])
	case "status":
		statusMain(os.Args[2:])
	case "node":
		nodeMain(os.Args[2:])
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`titan - Titan blockchain operations CLI

For a fresh server (recommended):
  ./scripts/titan-server-bootstrap.sh     # apt update + Go + deps + interactive full setup

Direct CLI usage:
  titan keys generate [--dir DIR] [--genesis]
  titan genesis align --from http://FIRST_NODE:9652
  titan wallet addresses --from @master.key
  titan wallet balances --from @master.key --uri http://127.0.0.1:9650
  titan node bootstrap --first ...
  titan node firewall --apply
  titan validator add --from <hex|@file> [--uri http://...]
  titan status

See TITAN_DEPLOY.md for the complete reset-and-launch flow.
The bootstrap command ends with a healthcheck.`)
}

func keysMain(args []string) {
	if len(args) == 0 || args[0] != "generate" {
		fmt.Fprintln(os.Stderr, "usage: titan keys generate [--dir DIR] [--genesis]")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("keys generate", flag.ExitOnError)
	dir := fs.String("dir", "titan-node-keys", "output directory")
	genesis := fs.Bool("genesis", false, "print genesis staker JSON for initialStakers")
	fs.Parse(args[1:])

	if err := generateTitanKeys(*dir, *genesis); err != nil {
		fmt.Fprintf(os.Stderr, "key generation failed: %v\n", err)
		os.Exit(1)
	}
}

func validatorMain(args []string) {
	if len(args) == 0 || args[0] != "add" {
		fmt.Fprintln(os.Stderr, "usage: titan validator add --from <hex|@file> [--uri http://...]")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("validator add", flag.ExitOnError)
	from := fs.String("from", "", "privkey hex or @file (required)")
	amount := fs.Float64("amount", 2000000, "TITAN to stake")
	days := fs.Int("duration-days", 14, "duration")
	uri := fs.String("uri", "http://127.0.0.1:9650", "node API")
	nodeIDFlag := fs.String("node-id", "", "override NodeID")
	pubFlag := fs.String("bls-pub", "", "override BLS pubkey")
	popFlag := fs.String("bls-pop", "", "override BLS proof")
	fs.Parse(args[1:])

	if *from == "" {
		fmt.Fprintln(os.Stderr, "--from is required (hex or @path)")
		os.Exit(1)
	}

	priv, err := loadKey(*from)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bad key: %v\n", err)
		os.Exit(1)
	}

	kc := secp256k1fx.NewKeychain(priv)
	addr := priv.Address()

	ctx := context.Background()
	w, err := primary.MakeWallet(ctx, *uri, kc, kc, primary.WalletConfig{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "wallet connect failed: %v\n", err)
		os.Exit(1)
	}

	cw := w.C()
	pw := w.P()

	amt := uint64(*amount * float64(units.Avax))
	owner := &secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{addr}}

	if err := transferCToP(ctx, *uri, cw, pw, amt, owner); err != nil {
		fmt.Fprintf(os.Stderr, "C→P transfer: %v\n", err)
		os.Exit(1)
	}

	// auto detect NodeID + POP from the target node's API if not provided
	var nodeID ids.NodeID
	var pop *signer.ProofOfPossession

	if *nodeIDFlag != "" {
		nodeID, _ = ids.NodeIDFromString(*nodeIDFlag)
	}
	if *pubFlag != "" && *popFlag != "" {
		pop = &signer.ProofOfPossession{}
		pb, _ := hex.DecodeString(strings.TrimPrefix(*pubFlag, "0x"))
		pp, _ := hex.DecodeString(strings.TrimPrefix(*popFlag, "0x"))
		copy(pop.PublicKey[:], pb)
		copy(pop.ProofOfPossession[:], pp)
	}

	if nodeID == ids.EmptyNodeID || pop == nil {
		fmt.Printf("Fetching NodeID + BLS POP from %s ...\n", *uri)
		infoClient := info.NewClient(*uri)
		fetchedID, fetchedPOP, err := infoClient.GetNodeID(context.Background())
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to fetch info.getNodeID from %s: %v\n", *uri, err)
			fmt.Fprintln(os.Stderr, "Provide --node-id --bls-pub --bls-pop manually.")
			os.Exit(1)
		}
		if nodeID == ids.EmptyNodeID {
			nodeID = fetchedID
		}
		if pop == nil {
			pop = fetchedPOP
		}
		fmt.Printf("  Using NodeID: %s\n", nodeID)
	}

	start := time.Now().Add(5 * time.Minute).Unix()
	end := time.Now().Add(time.Duration(*days)*24*time.Hour + 5*time.Minute).Unix()

	fmt.Printf("Adding validator %s ...\n", nodeID)
	tx, err := pw.IssueAddPermissionlessValidatorTx(
		&txs.SubnetValidator{Validator: txs.Validator{
			NodeID: nodeID, Start: uint64(start), End: uint64(end), Wght: amt,
		}},
		pop,
		pw.Builder().Context().AVAXAssetID,
		&secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{addr}},
		&secp256k1fx.OutputOwners{Threshold: 1, Addrs: []ids.ShortID{addr}},
		reward.PercentDenominator/4,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "add failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("\nAdded! tx = %s\n", tx.ID())
	fmt.Println("Check: curl $URI/ext/bc/P ... platform.getCurrentValidators")
}

func statusMain(args []string) {
	uri := "http://127.0.0.1:9650"
	if len(args) > 0 {
		uri = args[0]
	}
	fmt.Printf("Node: %s\n", uri)
	fmt.Println("Run these for now (we will make nice formatted output):")
	fmt.Printf("  curl -s %s/ext/info | jq '.result | {nodeID, nodePOP}'\n", uri)
	fmt.Printf("  curl -s %s/ext/health | jq '{healthy, bls: .checks.bls}'\n", uri)
	fmt.Printf("  curl -s %s/ext/bc/P -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"platform.getCurrentValidators\"}' | jq '.result.validators | length'\n", uri)
}

func nodeMain(args []string) {
	if len(args) == 0 || args[0] == "help" {
		fmt.Println(`titan node - setup and manage Titan nodes

Recommended high-level command:
  titan node bootstrap --first   # verifies keys, writes config, applies firewall, installs+starts systemd, runs healthcheck

Other subcommands:
  titan node setup --first
  titan node setup --join <ip:port> ...
  titan node verify-keys [--keys-dir path]
  titan node install-systemd --first --name titan-atlas ...
  titan node firewall --apply

The bootstrap command builds the running system and ends with a healthcheck.
First validator is special (baked into genesis).
`)
		return
	}

	switch args[0] {
	case "bootstrap":
		bootstrapMain(args[1:])
	case "setup":
		setupMain(args[1:])
	case "verify-keys":
		verifyKeysMain()
	case "install-systemd":
		installSystemdMain(args[1:])
	case "firewall":
		firewallMain(args[1:])
	default:
		fmt.Println("unknown node subcommand. Use 'titan node help'")
	}
}

func setupMain(args []string) {
	fs := flag.NewFlagSet("node setup", flag.ExitOnError)
	first := fs.Bool("first", false, "This is the genesis bootstrapper (ATLAS)")
	joinIP := fs.String("join", "", "bootstrap IP:port for additional node")
	joinID := fs.String("bootstrap-id", "", "bootstrap NodeID")
	keysDir := fs.String("keys-dir", "titan-staking", "directory with staker.crt/key + signer.key")
	dataDir := fs.String("data-dir", "/root/titan-data", "data directory")
	publicIP := fs.String("public-ip", "", "your public IP")
	fs.Parse(args)

	if *first {
		fmt.Println("=== Setting up FIRST / GENESIS validator (the bootstrapper) ===")
		fmt.Printf("Using keys from: %s\n", *keysDir)
		fmt.Println("IMPORTANT: These keys MUST match initialStakers in genesis_titan.json.")
		fmt.Println()

		cfg := nodeConfigJSON(*dataDir, *publicIP, *keysDir, "", "", "0.0.0.0")

		cfgPath := filepath.Join(*dataDir, "config.json")
		os.MkdirAll(*dataDir, 0755)
		if err := os.WriteFile(cfgPath, []byte(cfg), 0644); err == nil {
			fmt.Printf("Wrote config: %s\n", cfgPath)
		}

		fmt.Println("Recommended: use the config + systemd")
		fmt.Printf("  ./build/titan node install-systemd --first --name titan-atlas --data-dir %s --keys-dir %s --public-ip %s\n", *dataDir, *keysDir, *publicIP)
		fmt.Println()
		fmt.Println("Then:")
		fmt.Println("  sudo systemctl daemon-reload && sudo systemctl enable --now titan-atlas")
		fmt.Println()
		fmt.Println("Check with: ./build/titan status   and   platform.getCurrentValidators")
		fmt.Println("The first node is a validator automatically (no add tx).")
		return
	}

	if *joinIP != "" {
		fmt.Println("=== Setting up ADDITIONAL node (will need funding + validator registration) ===")
		fmt.Printf("Bootstrapping from: %s (id: %s)\n", *joinIP, *joinID)

		cfg := nodeConfigJSON(*dataDir, *publicIP, *keysDir, *joinIP, *joinID, "0.0.0.0")
		cfgPath := filepath.Join(*dataDir, "config.json")
		os.MkdirAll(*dataDir, 0755)
		if err := os.WriteFile(cfgPath, []byte(cfg), 0644); err == nil {
			fmt.Printf("Wrote config: %s\n", cfgPath)
		}

		fmt.Println()
		fmt.Println("1. On THIS machine, generate keys + start:")
		fmt.Printf("   titan keys generate --dir %s\n", *keysDir)
		fmt.Printf("   # bootstrap-ips=%s bootstrap-ids=%s (already in config.json)\n", *joinIP, *joinID)
		fmt.Println()
		fmt.Println("2. On CONTROL machine (with the master funded private key):")
		fmt.Printf("   titan validator add --from @master.key --uri http://this-node-ip:9650\n")
		fmt.Println()
		fmt.Println("3. Verify it appears as validator on any node:")
		fmt.Println("   curl ... platform.getCurrentValidators | grep your-NodeID")
		return
	}

	fmt.Println("Use --first for genesis bootstrapper or --join <ip:port> --bootstrap-id <NodeID>")
}

func bootstrapMain(args []string) {
	fs := flag.NewFlagSet("node bootstrap", flag.ExitOnError)
	first := fs.Bool("first", false, "setup as the genesis/ first validator")
	join := fs.String("join", "", "bootstrap IP:port for non-first node")
	bootstrapID := fs.String("bootstrap-id", "", "bootstrap NodeID for join")
	name := fs.String("name", "titan", "systemd service name")
	dataDir := fs.String("data-dir", "/root/titan-data", "data directory")
	keysDir := fs.String("keys-dir", "/root/keys", "directory containing staker.crt/key + signer.key")
	keysBackupDir := fs.String("keys-backup-dir", defaultGenesisKeysBackupDir, "first node: where to back up genesis keys on this server")
	publicIP := fs.String("public-ip", "", "public IP address")
	rewardAddr := fs.String("reward-address", defaultGenesisRewardAddress, "P-chain reward address for genesis validator")
	originURL := fs.String("origin-url", "", "origin bundle URL for join nodes (default: http://<join-host>:9652)")
	skipOriginAlign := fs.Bool("skip-origin-align", false, "DANGEROUS: skip genesis alignment with first node")
	skipRebuild := fs.Bool("skip-rebuild", false, "skip binary rebuild after genesis update (not recommended)")
	noWipeData := fs.Bool("no-wipe-data", false, "do not wipe data dir after genesis update")
	applyFirewall := fs.Bool("apply-firewall", true, "programmatically configure ufw firewall")
	restrictAPI := fs.Bool("restrict-api", false, "bind HTTP API to 127.0.0.1 only; do not open port 9650 in firewall (recommended for production)")
	skipSystemd := fs.Bool("skip-systemd", false, "do not install/start systemd")
	fs.Parse(args)

	httpHost := "0.0.0.0"
	if *restrictAPI {
		httpHost = "127.0.0.1"
		fmt.Println("  API restricted to localhost (use SSH tunnel: ssh -L 9650:127.0.0.1:9650 root@server)")
	}

	// Interactive fallback for missing critical values
	if *publicIP == "" {
		fmt.Print("Public IP for this node: ")
		fmt.Scanln(publicIP)
	}
	if *keysDir == "/root/keys" && *first {
		// already good default
	}
	if !*first && *join == "" {
		fmt.Print("Bootstrap IP:port (e.g. 165.22.0.208:9651): ")
		fmt.Scanln(join)
		fmt.Print("Bootstrap NodeID: ")
		fmt.Scanln(bootstrapID)
	}

	fmt.Println("=== Titan node bootstrap ===")

	os.MkdirAll(*dataDir, 0755)
	os.MkdirAll(filepath.Join(*dataDir, "db"), 0755)
	os.MkdirAll(filepath.Join(*dataDir, "logs"), 0755)

	bootIPs, bootIDs := bootstrapValues(*first, *join, *bootstrapID)
	if !*first && (bootIPs == "" || bootIDs == "") {
		fmt.Fprintln(os.Stderr, "bootstrap IP:port and NodeID are required for join nodes (--join / --bootstrap-id)")
		os.Exit(1)
	}

	if *first {
		fmt.Println("=== Preparing genesis validator keys ===")
		if err := prepareGenesisNodeKeys(*keysDir, *dataDir, *rewardAddr, *skipRebuild, *noWipeData); err != nil {
			fmt.Fprintf(os.Stderr, "genesis preparation failed: %v\n", err)
			os.Exit(1)
		}
		if err := publishOriginBundle(*dataDir); err != nil {
			fmt.Fprintf(os.Stderr, "failed to publish origin bundle: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("=== Backing up genesis keys on server ===")
		if err := backupGenesisKeys(*keysDir, *dataDir, *keysBackupDir); err != nil {
			fmt.Fprintf(os.Stderr, "genesis key backup failed: %v\n", err)
			os.Exit(1)
		}
		_ = secureKeysDir(*keysDir)
	} else {
		if !*skipOriginAlign {
			resolved := resolveOriginURL(*originURL, bootIPs)
			if resolved == "" {
				fmt.Fprintln(os.Stderr, "join nodes require --origin-url or --join (to derive http://host:9652)")
				os.Exit(1)
			}
			if err := alignWithOrigin(resolved); err != nil {
				fmt.Fprintf(os.Stderr, "genesis origin alignment failed: %v\n", err)
				fmt.Fprintln(os.Stderr, "Ensure the first node is running and port 9652 serves the origin bundle.")
				os.Exit(1)
			}
		} else {
			fmt.Println("WARNING: --skip-origin-align — this node may join a different chain than the bootstrapper.")
		}
		if err := ensureKeys(*keysDir, false); err != nil {
			fmt.Fprintf(os.Stderr, "failed to ensure staking keys: %v\n", err)
			os.Exit(1)
		}
		_ = secureKeysDir(*keysDir)
		fmt.Println("Join node keys ready. After bootstrap, register with:")
		fmt.Println("  titan validator add --from @master.key --uri http://THIS_NODE:9650")
	}

	cfgPath := filepath.Join(*dataDir, "config.json")
	cfg := nodeConfigJSON(*dataDir, *publicIP, *keysDir, bootIPs, bootIDs, httpHost)

	if err := os.WriteFile(cfgPath, []byte(cfg), 0644); err != nil {
		fmt.Printf("Warning: could not write config: %v\n", err)
	} else {
		fmt.Printf("Wrote %s\n", cfgPath)
	}

	// 3. Firewall
	if *applyFirewall {
		fmt.Println("\n=== Applying firewall ===")
		if *first {
			if *restrictAPI {
				fmt.Println("  First node: opening 22, 9651 (staking), 9652 (origin). API stays localhost-only.")
			} else {
				fmt.Println("  First node: opening 22, 9651 (staking), 9650 (API), 9652 (origin bundle)")
				fmt.Println("  WARNING: port 9650 is open to the world. Use --restrict-api for production.")
			}
		} else if *restrictAPI {
			fmt.Println("  Join node: opening 22, 9651 (staking). API stays localhost-only.")
		} else {
			fmt.Println("  Join node: opening 22, 9651 (staking), 9650 (API)")
			fmt.Println("  WARNING: port 9650 is open to the world. Use --restrict-api for production.")
		}
		if err := applyUFWFirewall(!*restrictAPI, *first); err != nil {
			fmt.Printf("Firewall apply had issues (run as root?): %v\n", err)
		}
	}

	if !*skipSystemd {
		fmt.Println("\n=== Installing systemd unit ===")
		if _, err := os.Stat("build/avalanchego"); err == nil {
			if err := runPrivileged("cp", "-f", "build/avalanchego", "/usr/local/bin/avalanchego"); err != nil {
				fmt.Printf("  Warning: could not copy binary to /usr/local/bin: %v\n", err)
			} else {
				fmt.Println("  Installed build/avalanchego to /usr/local/bin/avalanchego")
			}
			_ = runPrivileged("chmod", "+x", "/usr/local/bin/avalanchego")
		}
		if _, err := os.Stat("build/titan"); err == nil {
			_ = runPrivileged("cp", "-f", "build/titan", "/usr/local/bin/titan")
			_ = runPrivileged("chmod", "+x", "/usr/local/bin/titan")
		}
		installSystemdUnit(*name, *dataDir, "root")
		if *first {
			originSvc := *name + "-origin"
			if err := installOriginServeSystemd(originSvc, *dataDir); err != nil {
				fmt.Printf("  Warning: could not install origin server: %v\n", err)
			} else {
				_ = runPrivileged("systemctl", "daemon-reload")
				if err := runPrivileged("systemctl", "enable", "--now", originSvc); err != nil {
					fmt.Printf("  Warning: could not start origin server: %v\n", err)
				} else {
					fmt.Printf("  Origin bundle server started (%s on port %s)\n", originSvc, defaultOriginPort)
				}
			}
		}
	}

	if !*skipSystemd {
		fmt.Println("\nStarting service...")
		_ = runPrivileged("systemctl", "daemon-reload")
		if err := runPrivileged("systemctl", "enable", "--now", *name); err != nil {
			fmt.Printf("  Warning: could not start service: %v\n", err)
		}
	}

	// Healthcheck (LAST command/step)
	fmt.Println("\n=== Running healthcheck (final step) ===")
	resolvedOrigin := resolveOriginURL(*originURL, bootIPs)
	runHealthcheck(healthcheckOpts{
		isFirst:       *first,
		dataDir:       *dataDir,
		originURL:     resolvedOrigin,
		publicIP:      *publicIP,
		keysBackupDir: *keysBackupDir,
	})
}

type healthcheckOpts struct {
	isFirst       bool
	dataDir       string
	originURL     string
	publicIP      string
	keysBackupDir string
}

func installSystemdUnit(name, dataDir, user string) {
	if user == "" {
		user = "root"
	}
	cfgPath := filepath.Join(dataDir, "config.json")
	unit := fmt.Sprintf(`[Unit]
Description=Titan Node (%s)
After=network.target

[Service]
Type=simple
User=%s
WorkingDirectory=%s
ExecStart=/usr/local/bin/avalanchego --config-file=%s
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`, name, user, dataDir, cfgPath)

	path := fmt.Sprintf("/etc/systemd/system/%s.service", name)
	tmp := filepath.Join(os.TempDir(), name+".service")
	if err := os.WriteFile(tmp, []byte(unit), 0644); err != nil {
		fmt.Printf("  Could not write temp unit: %v\n", err)
		return
	}
	if err := runPrivileged("cp", tmp, path); err != nil {
		fmt.Printf("  Could not install %s: %v (try sudo)\n", path, err)
		return
	}
	fmt.Printf("  Wrote %s\n", path)
}

func waitForValidator(client *http.Client, uri, nodeID string, timeout time.Duration) bool {
	vdrPayload := `{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}`
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		vdrResp, err := client.Post(uri+"/ext/bc/P", "application/json", strings.NewReader(vdrPayload))
		if err == nil {
			var vdrResult struct {
				Result struct {
					Validators []struct {
						NodeID string `json:"nodeID"`
					} `json:"validators"`
				} `json:"result"`
			}
			json.NewDecoder(vdrResp.Body).Decode(&vdrResult)
			vdrResp.Body.Close()
			for _, v := range vdrResult.Result.Validators {
				if v.NodeID == nodeID {
					return true
				}
			}
		}
		time.Sleep(3 * time.Second)
	}
	return false
}

func runHealthcheck(opts healthcheckOpts) {
	uri := "http://127.0.0.1:9650"
	ctx := context.Background()
	infoClient := info.NewClient(uri)

	fmt.Println("  --- Origin / genesis checks ---")
	if opts.isFirst {
		if keysPresent(opts.keysBackupDir) {
			fmt.Printf("  ✓ Genesis keys backed up at %s\n", opts.keysBackupDir)
		} else {
			fmt.Printf("  ✗ Genesis key backup missing at %s\n", opts.keysBackupDir)
		}
		if err := waitAndVerifyLocalOriginServer(opts.publicIP); err != nil {
			fmt.Printf("  ✗ Origin server check failed: %v\n", err)
			fmt.Println("  Ensure titan-origin systemd is running and port 9652 is open (ufw + cloud firewall).")
		}
	} else if opts.originURL != "" {
		if err := verifyAlignedWithOrigin(opts.originURL); err != nil {
			fmt.Printf("  ✗ Genesis origin alignment check failed: %v\n", err)
		}
	}

	waitTimeout := 30 * time.Second
	if !opts.isFirst {
		waitTimeout = 10 * time.Minute
		fmt.Printf("  Join node: waiting up to %v for API and chain sync...\n", waitTimeout)
	}

	deadline := time.Now().Add(waitTimeout)
	var nodeID string

	for time.Now().Before(deadline) {
		id, _, err := infoClient.GetNodeID(ctx)
		if err == nil {
			nodeID = id.String()
			fmt.Printf("  ✓ /ext/info reachable (NodeID: %s)\n", nodeID)
			break
		}
		time.Sleep(3 * time.Second)
	}
	if nodeID == "" {
		fmt.Println("  /ext/info not reachable yet. Node may still be starting.")
		printHealthcheckFooter(uri, opts, nodeID)
		return
	}

	if networkID, err := infoClient.GetNetworkID(ctx); err != nil {
		fmt.Printf("  ! network ID check: %v\n", err)
	} else if networkID != constants.TitanID {
		fmt.Printf("  ✗ network ID %d is not Titan (%d) — wrong chain\n", networkID, constants.TitanID)
	} else {
		fmt.Printf("  ✓ network ID %d (titan)\n", networkID)
	}

	if !opts.isFirst {
		for _, chain := range []string{"P", "X", "C"} {
			synced, err := info.AwaitBootstrapped(ctx, infoClient, chain, 3*time.Second)
			if err != nil {
				fmt.Printf("  ! chain %s bootstrap check: %v\n", chain, err)
			} else if synced {
				fmt.Printf("  ✓ chain %s bootstrapped\n", chain)
			}
		}
	}

	client := &http.Client{Timeout: 5 * time.Second}
	if resp, err := client.Get(uri + "/ext/health"); err == nil {
		resp.Body.Close()
		fmt.Println("  ✓ /ext/health reachable")
	}

	if opts.isFirst {
		for _, chain := range []string{"P", "X", "C"} {
			synced, err := info.AwaitBootstrapped(ctx, infoClient, chain, 5*time.Second)
			if err != nil {
				fmt.Printf("  ! chain %s bootstrap check: %v\n", chain, err)
			} else if synced {
				fmt.Printf("  ✓ chain %s bootstrapped\n", chain)
			}
		}
		if found := waitForValidator(client, uri, nodeID, 90*time.Second); found {
			fmt.Printf("  ✓ Node %s is a genesis validator\n", nodeID)
		} else {
			fmt.Printf("  ✗ Node %s NOT in validators yet — check: journalctl -u titan-node -n 50\n", nodeID)
		}
	} else {
		fmt.Printf("  Join node %s synced. Register as validator with:\n", nodeID)
		fmt.Println("    titan validator add --from @master.key --uri http://THIS_NODE:9650")
		if opts.originURL != "" {
			fmt.Println("  --- Post-sync origin verification ---")
			if err := verifyAlignedWithOrigin(opts.originURL); err != nil {
				fmt.Printf("  ✗ Post-sync origin check failed: %v\n", err)
			}
		}
	}

	printHealthcheckFooter(uri, opts, nodeID)
}

func printHealthcheckFooter(uri string, opts healthcheckOpts, nodeID string) {
	fmt.Printf(`
Healthcheck complete.

Next steps:
  curl -s %s/ext/health | jq '.healthy, .checks.bls'
  curl -s %s/ext/bc/P -d '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' | jq
`, uri, uri)
	if opts.isFirst {
		if opts.keysBackupDir != "" {
			fmt.Printf("  ls -la %s   # offline backup of genesis keys\n", opts.keysBackupDir)
		}
		if opts.publicIP != "" {
			fmt.Printf("  curl -s http://%s:%s/anchor.json | jq .genesisHash\n", opts.publicIP, defaultOriginPort)
		}
		fmt.Println("  ./build/titan genesis fingerprint   # must match anchor.json genesisHash")
	} else if opts.originURL != "" {
		fmt.Printf("  curl -s %s/anchor.json | jq .genesisHash\n", opts.originURL)
		fmt.Println("  ./build/titan genesis fingerprint   # must match anchor.json genesisHash")
	}
	if !opts.isFirst && nodeID != "" {
		fmt.Printf("  titan validator add --from @master.key --uri %s\n", uri)
	}
	fmt.Println("\nBootstrap finished. Use: journalctl -u titan -f   or   ./build/titan status")
}

func installSystemdMain(args []string) {
	fs := flag.NewFlagSet("node install-systemd", flag.ExitOnError)
	name := fs.String("name", "titan", "service name (titan or titan-atlas, titan-prom etc)")
	dataDir := fs.String("data-dir", "/root/titan-data", "data dir")
	keysDir := fs.String("keys-dir", "/root/keys", "keys dir")
	publicIP := fs.String("public-ip", "", "public IP")
	isFirst := fs.Bool("first", false, "genesis bootstrapper (empty bootstrap)")
	joinIP := fs.String("join", "", "bootstrap IP:port for join nodes")
	bootstrapID := fs.String("bootstrap-id", "", "bootstrap NodeID for join nodes")
	user := fs.String("user", "root", "systemd user")
	restrictAPI := fs.Bool("restrict-api", false, "bind HTTP API to 127.0.0.1 only")
	fs.Parse(args)

	httpHost := "0.0.0.0"
	if *restrictAPI {
		httpHost = "127.0.0.1"
	}

	bootIPs, bootIDs := bootstrapValues(*isFirst, *joinIP, *bootstrapID)
	if !*isFirst && (bootIPs == "" || bootIDs == "") {
		fmt.Fprintln(os.Stderr, "join nodes require --join and --bootstrap-id")
		os.Exit(1)
	}

	cfgPath := filepath.Join(*dataDir, "config.json")
	os.MkdirAll(*dataDir, 0755)
	if err := os.WriteFile(cfgPath, []byte(nodeConfigJSON(*dataDir, *publicIP, *keysDir, bootIPs, bootIDs, httpHost)), 0644); err != nil {
		fmt.Printf("Failed to write %s: %v\n", cfgPath, err)
		os.Exit(1)
	}

	installSystemdUnit(*name, *dataDir, *user)
	fmt.Println("Now run:")
	fmt.Printf("  sudo systemctl daemon-reload\n")
	fmt.Printf("  sudo systemctl enable --now %s\n", *name)
	fmt.Printf("  journalctl -u %s -f\n", *name)
}

func firewallMain(args []string) {
	fs := flag.NewFlagSet("node firewall", flag.ExitOnError)
	apply := fs.Bool("apply", false, "actually apply the ufw rules (must run as root)")
	allowAPI := fs.Bool("allow-api", true, "allow 9650 (HTTP API) in addition to staking")
	fs.Parse(args)

	if !*apply {
		fmt.Println("Dry-run mode. Add --apply to actually configure firewall (run as root).")
		printFirewallCommands(*allowAPI)
		return
	}

	fmt.Println("Applying firewall rules with ufw...")
		if err := applyUFWFirewall(*allowAPI, false); err != nil {
		fmt.Printf("Failed to apply some rules: %v\n", err)
	}
	fmt.Println("Firewall configuration complete. Current status:")
	_ = runPrivileged("ufw", "status", "verbose")
}

func printFirewallCommands(allowAPI bool) {
	fmt.Println(`ufw allow 22/tcp comment 'SSH'
ufw allow 9651/tcp comment 'Titan staking p2p'`)
	if allowAPI {
		fmt.Println("ufw allow 9650/tcp comment 'Titan HTTP API'")
	}
	fmt.Println(`ufw --force enable
ufw status verbose`)
}

func applyUFWFirewall(allowAPI bool, allowOrigin bool) error {
	rules := [][]string{
		{"allow", "22/tcp"},
		{"allow", "9651/tcp"},
	}
	if allowAPI {
		rules = append(rules, []string{"allow", "9650/tcp"})
	}
	if allowOrigin {
		rules = append(rules, []string{"allow", defaultOriginPort + "/tcp"})
	}
	rules = append(rules, []string{"--force", "enable"})

	for _, r := range rules {
		fmt.Printf("> ufw %s\n", strings.Join(r, " "))
		cmd := append([]string{"ufw"}, r...)
		if err := runPrivileged(cmd[0], cmd[1:]...); err != nil {
			fmt.Printf("  (ufw returned: %v)\n", err)
		}
	}
	return nil
}

func verifyKeysMain() {
	fs := flag.NewFlagSet("node verify-keys", flag.ExitOnError)
	keysDir := fs.String("keys-dir", "../titan-staking", "directory with staker.crt and signer.key")
	fs.Parse(os.Args[3:])

	if !verifyGenesisKeys(*keysDir) {
		os.Exit(1)
	}
}

func loadKey(from string) (*secp256k1.PrivateKey, error) {
	s := strings.TrimPrefix(strings.TrimSpace(from), "0x")
	if strings.HasPrefix(from, "@") {
		path := strings.TrimSpace(strings.TrimPrefix(from, "@"))
		if strings.HasPrefix(path, "~/") {
			home, err := os.UserHomeDir()
			if err != nil {
				return nil, fmt.Errorf("resolve home dir: %w", err)
			}
			path = filepath.Join(home, path[2:])
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read key file %s: %w", path, err)
		}
		s = strings.TrimSpace(string(b))
		s = strings.TrimPrefix(s, "0x")
		s = strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, s)
	}
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("need 64 hex chars (got %d) — paste only the private key, no spaces or quotes", len(s))
	}
	return secp256k1.ToPrivateKey(b)
}
