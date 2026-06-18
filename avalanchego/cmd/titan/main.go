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
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
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
  titan node bootstrap --first ...
  titan node firewall --apply
  titan validator add --from <hex|@file> [--uri http://...]
  titan status

See TITAN_DEPLOY.md for the complete reset-and-launch flow.
The bootstrap command ends with a healthcheck.`)
}

func keysMain(args []string) {
	fs := flag.NewFlagSet("keys generate", flag.ExitOnError)
	dir := fs.String("dir", "titan-node-keys", "output directory")
	genesis := fs.Bool("genesis", false, "print genesis staker JSON")
	fs.Parse(args)

	// For now we just tell people to use the excellent existing script.
	// In a full revamp we would inline the generation here.
	fmt.Println("For the most complete key generation (with correct NodeID + POP for genesis), use:")
	fmt.Printf("  go run ./scripts/gen-titan-keys.go --dir=%s", *dir)
	if *genesis {
		fmt.Print(" --genesis")
	}
	fmt.Println()
	fmt.Println("\n(Full inline implementation coming in next iteration of the titan CLI)")
}

func validatorMain(args []string) {
	fs := flag.NewFlagSet("validator add", flag.ExitOnError)
	from := fs.String("from", "", "privkey hex or @file (required)")
	amount := fs.Float64("amount", 2000000, "TITAN to stake")
	days := fs.Int("duration-days", 14, "duration")
	uri := fs.String("uri", "http://127.0.0.1:9650", "node API")
	nodeIDFlag := fs.String("node-id", "", "override NodeID")
	pubFlag := fs.String("bls-pub", "", "override BLS pubkey")
	popFlag := fs.String("bls-pop", "", "override BLS proof")
	fs.Parse(args)

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

	fmt.Printf("Moving %.0f TITAN C→P...\n", *amount)
	exp, err := cw.IssueExportTx(constants.PlatformChainID, []*secp256k1fx.TransferOutput{{Amt: amt, OutputOwners: *owner}})
	if err != nil {
		fmt.Fprintf(os.Stderr, "export: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("export %s\n", exp.ID())

	time.Sleep(2 * time.Second)

	imp, err := pw.IssueImportTx(cw.Builder().Context().BlockchainID, owner)
	if err != nil {
		fmt.Fprintf(os.Stderr, "import: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("import %s\n", imp.ID())

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
  titan node verify-keys [--cert path]
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
		fmt.Println("IMPORTANT: These keys MUST produce exactly NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8")
		fmt.Println("and the POP that is in genesis_titan.json, otherwise it will not be a validator.")
		fmt.Println()

		// Generate a simple config file for less manual flags
		cfg := fmt.Sprintf(`{
  "network-id": "titan",
  "data-dir": "%s",
  "db-dir": "%s/db",
  "log-dir": "%s/logs",
  "http-host": "0.0.0.0",
  "http-port": 9650,
  "staking-port": 9651,
  "public-ip": "%s",
  "staking-tls-cert-file": "%s/staker.crt",
  "staking-tls-key-file": "%s/staker.key",
  "staking-signer-key-file": "%s/signer.key",
  "bootstrap-ips": "",
  "bootstrap-ids": "",
  "http-allowed-hosts": "*"
}`, *dataDir, *dataDir, *dataDir, *publicIP, *keysDir, *keysDir, *keysDir)

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
		fmt.Printf("Will generate fresh keys in ./titan-node-keys (run titan keys generate if you want to control location)\n")
		fmt.Println()
		fmt.Println("1. On THIS machine, generate keys + start:")
		fmt.Println("   titan keys generate --dir ./my-node-keys")
		fmt.Println("   # then start avalanchego with --bootstrap-ips=" + *joinIP + " --bootstrap-ids=" + *joinID)
		fmt.Println("   # and your new staker.* + signer.key")
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
	publicIP := fs.String("public-ip", "", "public IP address")
	applyFirewall := fs.Bool("apply-firewall", true, "programmatically configure ufw firewall")
	skipSystemd := fs.Bool("skip-systemd", false, "do not install/start systemd")
	fs.Parse(args)

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

	// 1. Keys verification for first node
	if *first {
		fmt.Println("Verifying genesis keys...")
		verifyForFirst(*keysDir)
	}

	// 2. Write config
	cfgPath := filepath.Join(*dataDir, "config.json")

	cfg := fmt.Sprintf(`{
  "network-id": "titan",
  "data-dir": "%s",
  "db-dir": "%s/db",
  "log-dir": "%s/logs",
  "http-host": "0.0.0.0",
  "http-port": 9650,
  "staking-port": 9651,
  "public-ip": "%s",
  "staking-tls-cert-file": "%s/staker.crt",
  "staking-tls-key-file": "%s/staker.key",
  "staking-signer-key-file": "%s/signer.key",
  "bootstrap-ips": "%s",
  "bootstrap-ids": "%s",
  "http-allowed-hosts": "*"
}`, *dataDir, *dataDir, *dataDir, *publicIP, *keysDir, *keysDir, *keysDir, "", "")

	if err := os.WriteFile(cfgPath, []byte(cfg), 0644); err != nil {
		fmt.Printf("Warning: could not write config: %v\n", err)
	} else {
		fmt.Printf("Wrote %s\n", cfgPath)
	}

	// 3. Firewall
	if *applyFirewall {
		fmt.Println("\n=== Applying firewall ===")
		if err := applyUFWFirewall(true); err != nil {
			fmt.Printf("Firewall apply had issues (run as root?): %v\n", err)
		}
	}

	// 4. Systemd + binary placement
	if !*skipSystemd {
		fmt.Println("\n=== Installing systemd unit ===")
		// Try to place the binary if we're in the build dir
		if _, err := os.Stat("build/avalanchego"); err == nil {
			exec.Command("cp", "build/avalanchego", "/usr/local/bin/avalanchego").Run()
			fmt.Println("  Copied build/avalanchego to /usr/local/bin/avalanchego (may need sudo in real run)")
		}
		installSystemdForBootstrap(*name, *dataDir, *keysDir, *publicIP, *first, *join, *bootstrapID)
	}

	// 5. Start
	if !*skipSystemd {
		fmt.Println("\nStarting service...")
		exec.Command("systemctl", "daemon-reload").Run()
		exec.Command("systemctl", "enable", "--now", *name).Run()
		fmt.Println("Waiting for node to come up (up to 15s)...")
		time.Sleep(5 * time.Second)
	}

	// 6. Healthcheck (LAST command/step)
	fmt.Println("\n=== Running healthcheck (final step) ===")
	runHealthcheck(*dataDir)
}

func verifyForFirst(keysDir string) {
	certPath := filepath.Join(keysDir, "staker.crt")
	expected := "NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8"
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		fmt.Printf("  Could not read %s: %v (make sure genesis keys are in %s)\n", certPath, err, keysDir)
		return
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		fmt.Println("  Bad PEM in cert")
		return
	}
	cert, _ := x509.ParseCertificate(block.Bytes)
	stakeCert, _ := staking.ParseCertificate(cert.Raw)
	nodeID := ids.NodeIDFromCert(stakeCert)
	if nodeID.String() == expected {
		fmt.Println("  ✓ Genesis key matches expected NodeID")
	} else {
		fmt.Printf("  ✗ Key mismatch! Got %s, want %s\n", nodeID, expected)
	}
}

func installSystemdForBootstrap(name, dataDir, keysDir, publicIP string, isFirst bool, bootIP, bootID string) {
	unit := fmt.Sprintf(`[Unit]
Description=Titan Node (%s)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=%s
ExecStart=/usr/local/bin/avalanchego --config-file=%s/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`, name, dataDir, dataDir)

	path := fmt.Sprintf("/etc/systemd/system/%s.service", name)
	if err := os.WriteFile(path, []byte(unit), 0644); err != nil {
		fmt.Printf("  Could not write %s: %v (try sudo)\n", path, err)
		return
	}
	fmt.Printf("  Wrote %s\n", path)
}

func runHealthcheck(dataDir string) {
	uri := "http://127.0.0.1:9650"
	client := &http.Client{Timeout: 3 * time.Second}

	var nodeID string

	// Try a few times for basic reachability + get NodeID
	for i := 0; i < 5; i++ {
		// Get NodeID
		infoResp, err := client.Post(uri+"/ext/info", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}`))
		if err == nil {
			var infoResult struct {
				Result struct {
					NodeID string `json:"nodeID"`
				} `json:"result"`
			}
			json.NewDecoder(infoResp.Body).Decode(&infoResult)
			infoResp.Body.Close()
			nodeID = infoResult.Result.NodeID
			fmt.Printf("  ✓ /ext/info reachable (NodeID: %s)\n", nodeID)
			break
		}
		if i == 4 {
			fmt.Printf("  /ext/info not yet reachable (%v). Node may still be starting.\n", err)
		}
		time.Sleep(2 * time.Second)
	}

	// Health
	resp, err := client.Get(uri + "/ext/health")
	if err == nil {
		resp.Body.Close()
		fmt.Println("  ✓ /ext/health reachable")
	}

	// Validator presence check (the important one for first + added nodes)
	if nodeID != "" {
		vdrPayload := `{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}`
		vdrResp, err := client.Post(uri+"/ext/bc/P", "application/json", strings.NewReader(vdrPayload))
		if err == nil {
			defer vdrResp.Body.Close()
			var vdrResult struct {
				Result struct {
					Validators []struct {
						NodeID string `json:"nodeID"`
					} `json:"validators"`
				} `json:"result"`
			}
			json.NewDecoder(vdrResp.Body).Decode(&vdrResult)

			found := false
			for _, v := range vdrResult.Result.Validators {
				if v.NodeID == nodeID {
					found = true
					break
				}
			}
			if found {
				fmt.Printf("  ✓ Node %s is present in current validators (good for genesis or added validator)\n", nodeID)
			} else {
				fmt.Printf("  ! Node %s NOT yet in current validators list (may need time or funding+add tx)\n", nodeID)
			}
		}
	}

	fmt.Printf(`
Healthcheck complete.

Next manual verification:
  curl -s %s/ext/health | jq '.healthy'
  curl -s %s/ext/bc/P -d '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' | jq

Bootstrap finished. Use: journalctl -u titan -f   or   ./build/titan status
`, uri, uri)
}

func installSystemdMain(args []string) {
	fs := flag.NewFlagSet("node install-systemd", flag.ExitOnError)
	name := fs.String("name", "titan", "service name (titan or titan-atlas, titan-prom etc)")
	dataDir := fs.String("data-dir", "/root/titan-data", "data dir")
	keysDir := fs.String("keys-dir", "/root/keys", "keys dir")
	publicIP := fs.String("public-ip", "", "public IP")
	isFirst := fs.Bool("first", false, "genesis bootstrapper (empty bootstrap)")
	user := fs.String("user", "root", "systemd user")
	fs.Parse(args)

	unit := fmt.Sprintf(`[Unit]
Description=Titan Blockchain Node (%s)
After=network.target

[Service]
Type=simple
User=%s
WorkingDirectory=%s
ExecStart=/usr/local/bin/avalanchego \
  --network-id=titan \
  --data-dir=%s \
  --db-dir=%s/db \
  --log-dir=%s/logs \
  --http-host=0.0.0.0 \
  --http-port=9650 \
  --staking-port=9651 \
  --public-ip=%s \
  --staking-tls-cert-file=%s/staker.crt \
  --staking-tls-key-file=%s/staker.key \
  --staking-signer-key-file=%s/signer.key \
  --bootstrap-ips="%s" \
  --bootstrap-ids="%s" \
  --http-allowed-hosts="*"
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`, *name, *user, *dataDir, *dataDir, *dataDir, *dataDir, *publicIP, *keysDir, *keysDir, *keysDir,
		map[bool]string{true: "", false: "YOUR_BOOTSTRAP_IP:9651"}[*isFirst],
		map[bool]string{true: "", false: "YOUR_BOOTSTRAP_NODEID"}[*isFirst])

	unitPath := fmt.Sprintf("/etc/systemd/system/%s.service", *name)
	if err := os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
		fmt.Printf("Failed to write %s: %v\n", unitPath, err)
		fmt.Println("Run with sudo or copy the output manually.")
		return
	}

	fmt.Printf("Wrote %s\n", unitPath)
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
	if err := applyUFWFirewall(*allowAPI); err != nil {
		fmt.Printf("Failed to apply some rules: %v\n", err)
	}
	fmt.Println("Firewall configuration complete. Current status:")
	exec.Command("ufw", "status", "verbose").Run()
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

func applyUFWFirewall(allowAPI bool) error {
	rules := [][]string{
		{"allow", "22/tcp"},
		{"allow", "9651/tcp"},
	}
	if allowAPI {
		rules = append(rules, []string{"allow", "9650/tcp"})
	}
	rules = append(rules, []string{"--force", "enable"})

	for _, r := range rules {
		cmd := append([]string{"ufw"}, r...)
		fmt.Printf("> ufw %s\n", strings.Join(r, " "))
		out, err := exec.Command(cmd[0], cmd[1:]...).CombinedOutput()
		if len(out) > 0 {
			fmt.Printf("%s", out)
		}
		if err != nil {
			fmt.Printf("  (ufw returned: %v)\n", err)
		}
	}
	return nil
}

func verifyKeysMain() {
	fs := flag.NewFlagSet("node verify-keys", flag.ExitOnError)
	certPath := fs.String("cert", "../titan-staking/staker.crt", "path to staker.crt")
	fs.Parse(os.Args[3:]) // best effort after "node verify-keys"

	expected := "NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8"

	certPEM, err := os.ReadFile(*certPath)
	if err != nil {
		fmt.Printf("Could not read cert: %v\n", err)
		return
	}

	block, _ := pem.Decode(certPEM)
	if block == nil {
		fmt.Println("failed to decode PEM")
		return
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		fmt.Printf("parse cert: %v\n", err)
		return
	}
	stakeCert, err := staking.ParseCertificate(cert.Raw)
	if err != nil {
		fmt.Printf("staking.ParseCertificate: %v\n", err)
		return
	}
	nodeID := ids.NodeIDFromCert(stakeCert)

	fmt.Printf("Computed NodeID from %s: %s\n", *certPath, nodeID)
	if nodeID.String() == expected {
		fmt.Println("✓ Matches expected genesis validator NodeID!")
	} else {
		fmt.Printf("✗ MISMATCH. Expected %s. You must use the exact genesis staking keys.\n", expected)
	}
}

func loadKey(from string) (*secp256k1.PrivateKey, error) {
	s := strings.TrimPrefix(strings.TrimSpace(from), "0x")
	if strings.HasPrefix(from, "@") {
		b, _ := os.ReadFile(strings.TrimPrefix(from, "@"))
		s = strings.TrimSpace(string(b))
		s = strings.TrimPrefix(s, "0x")
	}
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("need 64 hex chars")
	}
	return secp256k1.ToPrivateKey(b)
}
