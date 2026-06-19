package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/ava-labs/avalanchego/genesis"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/hashing"
)

const (
	originDirName     = "titan-origin"
	originAnchorFile  = "anchor.json"
	originGenesisFile = "genesis_titan.json"
	defaultOriginPort = "9652"
)

// TitanOriginAnchor is the canonical fingerprint of a Titan network genesis.
// Join nodes download this from the first node before building their binary.
type TitanOriginAnchor struct {
	NetworkID       uint32 `json:"networkID"`
	NetworkName     string `json:"networkName"`
	GenesisHash     string `json:"genesisHash"`
	GenesisNodeID   string `json:"genesisNodeID"`
	GenesisStakerPK string `json:"genesisStakerPublicKey,omitempty"`
	ExportedAt      string `json:"exportedAt"`
}

func computeGenesisFingerprintFromConfig(cfg *genesis.Config) (string, error) {
	genesisBytes, _, err := genesis.FromConfig(cfg)
	if err != nil {
		return "", fmt.Errorf("build genesis bytes: %w", err)
	}
	return hex.EncodeToString(hashing.ComputeHash256(genesisBytes)), nil
}

func computeEmbeddedGenesisFingerprint() (string, error) {
	cfg := genesis.GetConfig(constants.TitanID)
	return computeGenesisFingerprintFromConfig(cfg)
}

func computeFileGenesisFingerprint(genesisPath string) (string, error) {
	cfg, err := genesis.GetConfigFile(genesisPath)
	if err != nil {
		return "", err
	}
	return computeGenesisFingerprintFromConfig(cfg)
}

func originBundleDir(dataDir string) string {
	return filepath.Join(dataDir, originDirName)
}

func buildAnchorFromGenesisPath(genesisPath string) (*TitanOriginAnchor, error) {
	cfg, err := genesis.GetConfigFile(genesisPath)
	if err != nil {
		return nil, err
	}
	hash, err := computeGenesisFingerprintFromConfig(cfg)
	if err != nil {
		return nil, err
	}
	if len(cfg.InitialStakers) == 0 {
		return nil, fmt.Errorf("genesis has no initialStakers")
	}
	s := cfg.InitialStakers[0]
	anchor := &TitanOriginAnchor{
		NetworkID:     cfg.NetworkID,
		NetworkName:   constants.NetworkName(cfg.NetworkID),
		GenesisHash:   hash,
		GenesisNodeID: s.NodeID.String(),
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	if s.Signer != nil {
		anchor.GenesisStakerPK = "0x" + hex.EncodeToString(s.Signer.PublicKey[:])
	}
	return anchor, nil
}

// publishOriginBundle writes anchor.json + genesis_titan.json for join nodes to fetch.
func publishOriginBundle(dataDir string) error {
	genesisPath, err := findGenesisJSONPath()
	if err != nil {
		return err
	}

	bundleDir := originBundleDir(dataDir)
	if err := os.MkdirAll(bundleDir, 0755); err != nil {
		return err
	}

	anchor, err := buildAnchorFromGenesisPath(genesisPath)
	if err != nil {
		return fmt.Errorf("build origin anchor: %w", err)
	}

	anchorBytes, err := json.MarshalIndent(anchor, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(bundleDir, originAnchorFile), anchorBytes, 0644); err != nil {
		return err
	}

	genesisBytes, err := os.ReadFile(genesisPath)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(bundleDir, originGenesisFile), genesisBytes, 0644); err != nil {
		return err
	}
	if err := scrubOriginBundleDir(bundleDir); err != nil {
		return err
	}

	fmt.Println("=== Titan origin bundle published ===")
	fmt.Println("  (Public only: anchor + genesis JSON. Private staking keys are NOT served.)")
	fmt.Printf("  Directory: %s\n", bundleDir)
	fmt.Printf("  Genesis hash: %s\n", anchor.GenesisHash)
	fmt.Printf("  Genesis NodeID: %s\n", anchor.GenesisNodeID)
	fmt.Println()
	fmt.Println("Join nodes MUST align before starting:")
	fmt.Printf("  titan genesis align --from http://THIS_SERVER_IP:%s\n", defaultOriginPort)
	return nil
}

func fetchOriginAnchor(baseURL string) (*TitanOriginAnchor, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	resp, err := http.Get(baseURL + "/" + originAnchorFile)
	if err != nil {
		return nil, fmt.Errorf("fetch anchor from %s: %w", baseURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch anchor HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var anchor TitanOriginAnchor
	if err := json.NewDecoder(resp.Body).Decode(&anchor); err != nil {
		return nil, fmt.Errorf("decode anchor: %w", err)
	}
	if anchor.GenesisHash == "" || anchor.GenesisNodeID == "" {
		return nil, fmt.Errorf("anchor from %s is incomplete", baseURL)
	}
	if anchor.NetworkID != 0 && anchor.NetworkID != constants.TitanID {
		return nil, fmt.Errorf("anchor networkID %d is not Titan (%d)", anchor.NetworkID, constants.TitanID)
	}
	return &anchor, nil
}

func downloadOriginGenesis(baseURL, destPath string) error {
	baseURL = strings.TrimRight(baseURL, "/")
	resp, err := http.Get(baseURL + "/" + originGenesisFile)
	if err != nil {
		return fmt.Errorf("fetch genesis: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fetch genesis HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	tmp := destPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, destPath)
}

// alignWithOrigin downloads the canonical genesis from the first node, installs it,
// rebuilds the local binary, and verifies the embedded fingerprint matches.
func alignWithOrigin(originURL string) error {
	fmt.Printf("=== Aligning with Titan origin at %s ===\n", originURL)

	anchor, err := fetchOriginAnchor(originURL)
	if err != nil {
		return err
	}
	fmt.Printf("  Remote genesis hash: %s\n", anchor.GenesisHash)
	fmt.Printf("  Remote genesis NodeID: %s\n", anchor.GenesisNodeID)

	localHash, err := computeEmbeddedGenesisFingerprint()
	if err != nil {
		return err
	}
	if localHash == anchor.GenesisHash {
		fmt.Println("  ✓ Local binary already matches origin genesis — no rebuild needed.")
		return nil
	}

	fmt.Printf("  Local embedded hash: %s (mismatch — syncing genesis)\n", localHash)

	genesisPath, err := findGenesisJSONPath()
	if err != nil {
		return err
	}
	if err := downloadOriginGenesis(originURL, genesisPath); err != nil {
		return err
	}
	fmt.Printf("  Installed %s from origin\n", genesisPath)

	fileHash, err := computeFileGenesisFingerprint(genesisPath)
	if err != nil {
		return err
	}
	if fileHash != anchor.GenesisHash {
		return fmt.Errorf("downloaded genesis hash %s does not match anchor %s", fileHash, anchor.GenesisHash)
	}

	if err := rebuildBinaries(); err != nil {
		return err
	}

	// Verify the rebuilt ./build/titan binary, not this running CLI process
	// (the old binary still embeds the pre-align genesis until re-exec).
	if err := verifyBuiltBinaryFingerprint(anchor.GenesisHash); err != nil {
		return fmt.Errorf("after rebuild: %w", err)
	}

	if err := installBuiltBinaries(false, "titan-node", "titan-node-origin"); err != nil {
		fmt.Printf("  Warning: could not install rebuilt binaries: %v\n", err)
	}

	fmt.Println("  ✓ Genesis aligned and binary rebuilt to match origin.")
	return nil
}

func resolveOriginURL(explicitURL, joinIPPort string) string {
	if explicitURL != "" {
		return strings.TrimRight(explicitURL, "/")
	}
	if joinIPPort == "" {
		return ""
	}
	host := joinIPPort
	if idx := strings.LastIndex(joinIPPort, ":"); idx != -1 {
		host = joinIPPort[:idx]
	}
	host = strings.Trim(host, "[]")
	return fmt.Sprintf("http://%s:%s", host, defaultOriginPort)
}

func installOriginServeSystemd(serviceName, dataDir string) error {
	bundleDir := originBundleDir(dataDir)
	unit := fmt.Sprintf(`[Unit]
Description=Titan Origin Bundle Server (%s)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=%s
ExecStart=/usr/local/bin/titan genesis serve --data-dir=%s --port=%s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`, serviceName, dataDir, dataDir, defaultOriginPort)

	path := fmt.Sprintf("/etc/systemd/system/%s.service", serviceName)
	tmp := filepath.Join(os.TempDir(), serviceName+".service")
	if err := os.WriteFile(tmp, []byte(unit), 0644); err != nil {
		return err
	}
	if err := runPrivileged("cp", tmp, path); err != nil {
		return err
	}
	fmt.Printf("  Installed origin server unit: %s (serves %s)\n", path, bundleDir)
	return nil
}

func shortGenesisHash(hash string) string {
	if len(hash) > 16 {
		return hash[:16] + "..."
	}
	return hash
}

func verifyEmbeddedMatchesAnchor(anchor *TitanOriginAnchor) error {
	localHash, err := computeEmbeddedGenesisFingerprint()
	if err != nil {
		return err
	}
	if localHash != anchor.GenesisHash {
		return fmt.Errorf("embedded genesis %s != origin anchor %s", localHash, anchor.GenesisHash)
	}
	return nil
}

func verifyOnDiskGenesisMatchesAnchor(anchor *TitanOriginAnchor) error {
	genesisPath, err := findGenesisJSONPath()
	if err != nil {
		return err
	}
	fileHash, err := computeFileGenesisFingerprint(genesisPath)
	if err != nil {
		return err
	}
	if fileHash != anchor.GenesisHash {
		return fmt.Errorf("on-disk genesis %s != origin anchor %s", fileHash, anchor.GenesisHash)
	}
	return nil
}

// verifyBuiltBinaryFingerprint checks the rebuilt ./build/titan binary (not the running CLI process).
func verifyBuiltBinaryFingerprint(expected string) error {
	avagoDir, err := findAvalanchegoDir()
	if err != nil {
		return err
	}
	titanBin := filepath.Join(avagoDir, "build", "titan")
	if _, err := os.Stat(titanBin); err != nil {
		return fmt.Errorf("rebuilt titan binary missing at %s: %w", titanBin, err)
	}
	cmd := exec.Command(titanBin, "genesis", "fingerprint")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("fingerprint command failed: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	line := strings.TrimSpace(string(out))
	const prefix = "embedded genesis hash:"
	if !strings.Contains(line, prefix) {
		return fmt.Errorf("unexpected fingerprint output: %s", line)
	}
	got := strings.TrimSpace(strings.TrimPrefix(line, prefix))
	if got != expected {
		return fmt.Errorf("rebuilt binary hash %s != expected %s", got, expected)
	}
	fmt.Printf("  ✓ Rebuilt binary embeds genesis hash: %s\n", shortGenesisHash(got))
	return nil
}

func verifyGenesisMatchesAnchor(anchor *TitanOriginAnchor) error {
	if err := verifyOnDiskGenesisMatchesAnchor(anchor); err != nil {
		return err
	}
	if err := verifyBuiltBinaryFingerprint(anchor.GenesisHash); err != nil {
		return fmt.Errorf("%w (on-disk genesis matches origin; rebuild or re-run bootstrap)", err)
	}
	return nil
}

// waitAndVerifyLocalOriginServer checks the first node's origin HTTP service on :9652.
func waitAndVerifyLocalOriginServer(publicIP string) error {
	baseURL := "http://127.0.0.1:" + defaultOriginPort
	deadline := time.Now().Add(30 * time.Second)
	var anchor *TitanOriginAnchor
	var lastErr error
	for time.Now().Before(deadline) {
		anchor, lastErr = fetchOriginAnchor(baseURL)
		if lastErr == nil {
			break
		}
		time.Sleep(2 * time.Second)
	}
	if anchor == nil {
		return fmt.Errorf("origin server not reachable at %s: %v", baseURL, lastErr)
	}
	if err := verifyOnDiskGenesisMatchesAnchor(anchor); err != nil {
		return fmt.Errorf("origin bundle mismatch: %w", err)
	}
	if err := verifyBuiltBinaryFingerprint(anchor.GenesisHash); err != nil {
		return err
	}
	fmt.Printf("  ✓ Origin server healthy on :%s (genesis hash: %s)\n", defaultOriginPort, shortGenesisHash(anchor.GenesisHash))
	fmt.Printf("  ✓ Genesis validator NodeID: %s\n", anchor.GenesisNodeID)
	if publicIP != "" {
		fmt.Printf("  ✓ Join nodes align from: http://%s:%s\n", publicIP, defaultOriginPort)
	}
	return nil
}

// verifyAlignedWithOrigin confirms the local binary embeds the same genesis as the remote origin.
func verifyAlignedWithOrigin(originURL string) error {
	if originURL == "" {
		return fmt.Errorf("origin URL not configured")
	}
	anchor, err := fetchOriginAnchor(originURL)
	if err != nil {
		return err
	}
	if err := verifyGenesisMatchesAnchor(anchor); err != nil {
		return fmt.Errorf("%w — node would be on a different chain than %s", err, originURL)
	}
	fmt.Printf("  ✓ Genesis origin aligned with %s (hash: %s)\n", originURL, shortGenesisHash(anchor.GenesisHash))
	fmt.Printf("  ✓ Remote genesis NodeID: %s\n", anchor.GenesisNodeID)
	return nil
}

var originBundleAllowedFiles = map[string]bool{
	originAnchorFile:  true,
	originGenesisFile: true,
}

func scrubOriginBundleDir(bundleDir string) error {
	entries, err := os.ReadDir(bundleDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if err := os.RemoveAll(filepath.Join(bundleDir, entry.Name())); err != nil {
				return fmt.Errorf("remove unexpected origin subdir %s: %w", entry.Name(), err)
			}
			fmt.Printf("  Warning: removed unexpected subdirectory from origin bundle: %s\n", entry.Name())
			continue
		}
		name := entry.Name()
		if originBundleAllowedFiles[name] {
			continue
		}
		if isSensitiveKeyFilename(name) {
			return fmt.Errorf("refusing to publish origin bundle: sensitive file %s in %s", name, bundleDir)
		}
		if err := os.Remove(filepath.Join(bundleDir, name)); err != nil {
			return fmt.Errorf("remove unexpected origin file %s: %w", name, err)
		}
		fmt.Printf("  Warning: removed unexpected file from origin bundle: %s\n", name)
	}
	return nil
}

func isSensitiveKeyFilename(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".key") ||
		strings.HasSuffix(lower, ".pem") ||
		name == "staker.crt" ||
		name == "backup-info.json" ||
		name == "README.txt"
}

func newOriginHTTPHandler(bundleDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "." || name == "/" || name == "" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if !originBundleAllowedFiles[name] {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(bundleDir, name))
	})
}

func serveOrigin(dataDir, port string) error {
	bundleDir := originBundleDir(dataDir)
	if _, err := os.Stat(filepath.Join(bundleDir, originAnchorFile)); err != nil {
		return fmt.Errorf("origin bundle missing in %s — run bootstrap --first first", bundleDir)
	}
	if err := scrubOriginBundleDir(bundleDir); err != nil {
		return err
	}
	addr := ":" + port
	fmt.Printf("Serving Titan origin bundle at http://0.0.0.0%s/ (whitelist: %s, %s only)\n", addr, originAnchorFile, originGenesisFile)
	fmt.Printf("  anchor:  http://<this-host>:%s/%s\n", port, originAnchorFile)
	fmt.Printf("  genesis: http://<this-host>:%s/%s\n", port, originGenesisFile)
	return http.ListenAndServe(addr, newOriginHTTPHandler(bundleDir))
}

func genesisMain(args []string) {
	if len(args) == 0 {
		fmt.Println(`titan genesis - origin chain alignment

  titan genesis fingerprint              # show embedded genesis hash
  titan genesis publish --data-dir DIR   # write origin bundle (first node)
  titan genesis align --from URL         # sync genesis from first node + rebuild
  titan genesis serve --data-dir DIR     # HTTP serve origin bundle (port 9652)`)
		return
	}

	switch args[0] {
	case "fingerprint":
		hash, err := computeEmbeddedGenesisFingerprint()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("embedded genesis hash: %s\n", hash)
	case "publish":
		fs := flag.NewFlagSet("genesis publish", flag.ExitOnError)
		dataDir := fs.String("data-dir", "/root/titan-data", "data directory")
		fs.Parse(args[1:])
		if err := publishOriginBundle(*dataDir); err != nil {
			fmt.Fprintf(os.Stderr, "publish failed: %v\n", err)
			os.Exit(1)
		}
	case "align":
		fs := flag.NewFlagSet("genesis align", flag.ExitOnError)
		from := fs.String("from", "", "origin base URL (e.g. http://atlas:9652)")
		fs.Parse(args[1:])
		if *from == "" {
			fmt.Fprintln(os.Stderr, "--from is required")
			os.Exit(1)
		}
		if err := alignWithOrigin(strings.TrimRight(*from, "/")); err != nil {
			fmt.Fprintf(os.Stderr, "align failed: %v\n", err)
			os.Exit(1)
		}
	case "serve":
		fs := flag.NewFlagSet("genesis serve", flag.ExitOnError)
		dataDir := fs.String("data-dir", "/root/titan-data", "data directory")
		port := fs.String("port", defaultOriginPort, "listen port")
		fs.Parse(args[1:])
		if err := serveOrigin(*dataDir, *port); err != nil {
			fmt.Fprintf(os.Stderr, "serve failed: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown genesis subcommand: %s\n", args[0])
		os.Exit(1)
	}
}