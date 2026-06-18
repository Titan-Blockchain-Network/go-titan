// gen-titan-keys.go
//
// Utility to generate staking keys for Titan Blockchain nodes.
//
// Usage:
//
//   # Generate keys for a regular additional node
//   go run scripts/gen-titan-keys.go
//
//   # Generate keys for the genesis / bootstrapper node (origin keys)
//   go run scripts/gen-titan-keys.go --genesis
//
//   # Custom output directory
//   go run scripts/gen-titan-keys.go --dir=my-node-keys --genesis
//
// Output files:
//   - staker.crt + staker.key   → TLS certificate for staking (determines NodeID)
//   - signer.key                → BLS secret key (for proof of possession + validator signing)
//
// For genesis nodes, the script also prints the exact JSON object you need
// to put into "initialStakers" in a genesis file.

package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
	"github.com/ava-labs/avalanchego/utils/crypto/bls/signer/localsigner"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
)

func main() {
	dirFlag := flag.String("dir", "", "Output directory for the keys (default: titan-node-keys or titan-genesis-keys)")
	genesisFlag := flag.Bool("genesis", false, "Generate keys intended for the genesis bootstrapper (prints genesis staker JSON)")
	flag.Parse()

	var outDir string
	if *dirFlag != "" {
		outDir = *dirFlag
	} else if *genesisFlag {
		outDir = "titan-genesis-keys"
	} else {
		outDir = "titan-node-keys"
	}

	if err := os.MkdirAll(outDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create directory %s: %v\n", outDir, err)
		os.Exit(1)
	}

	// 1. Generate staking TLS certificate + key
	certPEM, keyPEM, err := staking.NewCertAndKeyBytes()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to generate staking certificate: %v\n", err)
		os.Exit(1)
	}

	certPath := filepath.Join(outDir, "staker.crt")
	keyPath := filepath.Join(outDir, "staker.key")
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write %s: %v\n", certPath, err)
		os.Exit(1)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write %s: %v\n", keyPath, err)
		os.Exit(1)
	}

	// Load to derive NodeID
	tlsCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse generated certificate: %v\n", err)
		os.Exit(1)
	}
	if tlsCert.Leaf == nil {
		tlsCert.Leaf, err = x509.ParseCertificate(tlsCert.Certificate[0])
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to parse certificate leaf: %v\n", err)
			os.Exit(1)
		}
	}
	stakingCert, err := staking.ParseCertificate(tlsCert.Leaf.Raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse staking certificate: %v\n", err)
		os.Exit(1)
	}
	nodeID := ids.NodeIDFromCert(stakingCert)

	// 2. Generate BLS signer key (for proof of possession)
	blsSk, err := localsigner.New()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to generate BLS signer key: %v\n", err)
		os.Exit(1)
	}
	signerPath := filepath.Join(outDir, "signer.key")
	if err := os.WriteFile(signerPath, blsSk.ToBytes(), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write %s: %v\n", signerPath, err)
		os.Exit(1)
	}

	// 3. Create proof of possession
	pop, err := signer.NewProofOfPossession(blsSk)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create proof of possession: %v\n", err)
		os.Exit(1)
	}

	pkHex := hex.EncodeToString(pop.PublicKey[:])
	popHex := hex.EncodeToString(pop.ProofOfPossession[:])

	fmt.Println("================================================================")
	fmt.Printf("Titan node keys generated successfully!\n\n")
	fmt.Printf("Output directory: %s\n\n", outDir)
	fmt.Printf("NodeID:            %s\n", nodeID)
	fmt.Printf("BLS Public Key:    0x%s\n", pkHex)
	fmt.Printf("Proof of Possession: 0x%s\n\n", popHex)

	fmt.Println("Files written:")
	fmt.Printf("  %s  (staking certificate - public)\n", certPath)
	fmt.Printf("  %s  (staking private key - SECRET)\n", keyPath)
	fmt.Printf("  %s  (BLS signer key - SECRET)\n\n", signerPath)

	if *genesisFlag {
		fmt.Println(">>> THIS SET IS FOR THE GENESIS BOOTSTRAPPER <<<")
		fmt.Println()
		fmt.Println("To use these keys as the initial validator, you must put the")
		fmt.Println("following object into the 'initialStakers' array of your genesis JSON:")
		fmt.Println()

		stakerEntry := map[string]interface{}{
			"nodeID":        nodeID.String(),
			"rewardAddress": "P-titan1" + "REPLACE_WITH_YOUR_P_TITAN_ADDRESS",
			"delegationFee": 0,
			"signer": map[string]string{
				"publicKey":         "0x" + pkHex,
				"proofOfPossession": "0x" + popHex,
			},
		}

		pretty, _ := json.MarshalIndent(stakerEntry, "", "  ")
		fmt.Println(string(pretty))
		fmt.Println()
		fmt.Println("Important:")
		fmt.Println("  - Replace 'P-titan1REPLACE_WITH_YOUR_P_TITAN_ADDRESS' with a real P-titan address")
		fmt.Println("    that will receive the staking rewards for this genesis validator.")
		fmt.Println("  - You also need a matching allocation in the genesis that can cover the stake.")
		fmt.Println("  - After editing genesis_titan.json, rebuild with ./scripts/build.sh")
		fmt.Println()
		fmt.Println("Security: Copy the three files in this directory to a very safe place.")
		fmt.Println("          They are the only way to run the genesis validator identity.")
	} else {
		fmt.Println(">>> Keys for an additional / regular Titan node <<<")
		fmt.Println()
		fmt.Println("How to use these on a new node:")
		fmt.Println("  1. Copy the three files to your new server.")
		fmt.Println("  2. Start the node with:")
		fmt.Printf("     --staking-tls-cert-file=.../staker.crt\n")
		fmt.Printf("     --staking-tls-key-file=.../staker.key\n")
		fmt.Printf("     --staking-signer-key-file=.../signer.key\n")
		fmt.Println("  3. Bootstrap from an existing node, e.g.:")
		fmt.Println("     --bootstrap-ips=IP_OF_FIRST_NODE:9651")
		fmt.Println("     --bootstrap-ids=NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8")
		fmt.Println()
		fmt.Println("After the node is healthy you can add it as a validator on-chain")
		fmt.Println("using platform.addPermissionlessValidator (or a wallet).")
	}

	fmt.Println("================================================================")
	fmt.Println("BACK UP THE .key FILES NOW. Losing them means losing the validator identity.")
}