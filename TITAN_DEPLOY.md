# Titan Blockchain - Node Deployment Guide

This document explains how to run the first bootstrapper node and how to add more nodes later.

**Network details**
- Network name: `titan`
- Network ID: `888` (or `titan`)
- Address HRP: `titan` → `X-titan1...` / `P-titan1...`
- C-Chain chainId: `888`
- Primary asset: **TITAN** (symbol `TITAN`)

## Important: The Genesis Validator Keys

The genesis file (`avalanchego/genesis/genesis_titan.json`) hardcodes **one initial validator**.

The **public** information (NodeID + BLS public key + proof of possession) is committed in the repository.

The **private** keys are **not** in the code:
- `staker.crt` + `staker.key` (TLS staking identity → determines the NodeID)
- `signer.key` (BLS key used for proof of possession and signing)

### What you must do right now

1. Securely back up the entire `titan-staking/` directory (or the three files) **immediately**.
2. Copy them to the machine that will run the **first bootstrapper node**.
3. Store extra copies offline (USB, password manager, paper, multiple people, etc.).
4. **Never** commit these private files to git.

Only the machine(s) running the genesis-listed validator(s) need these exact private keys.

## First Node (Bootstrapper) Deployment

### 1. Build

```bash
cd avalanchego
./scripts/build.sh
```

The binary will be at `build/avalanchego`.

### 2. Prepare directories and keys

```bash
# On the target machine
mkdir -p /opt/titan/data/db /opt/titan/data/logs /opt/titan/keys

# Copy the three genesis validator key files here (from your secure backup)
cp staker.crt staker.key signer.key /opt/titan/keys/
chmod 600 /opt/titan/keys/staker.key /opt/titan/keys/signer.key
```

### 3. Start the first node

```bash
./build/avalanchego \
  --network-id=titan \
  --data-dir=/opt/titan/data \
  --db-dir=/opt/titan/data/db \
  --log-dir=/opt/titan/data/logs \
  --log-level=info \
  --http-host=0.0.0.0 \
  --http-port=9650 \
  --staking-port=9651 \
  --public-ip=YOUR_PUBLIC_IP \
  --staking-tls-cert-file=/opt/titan/keys/staker.crt \
  --staking-tls-key-file=/opt/titan/keys/staker.key \
  --staking-signer-key-file=/opt/titan/keys/signer.key \
  --bootstrap-ips="" \
  --bootstrap-ids="" \
  --http-allowed-hosts="*"
```

**Key points for the first node:**
- `--bootstrap-ips=""` and `--bootstrap-ids=""` (empty) → it starts from its own genesis.
- It must use the exact keys that match the NodeID in genesis.
- Expose port **9651** (staking) and **9650** (HTTP) as needed.
- Once running, verify:
  ```bash
  curl -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' \
    http://localhost:9650/ext/info
  ```

The node should report `NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8`.

## Adding More Nodes (Consecutive Nodes)

### Step 1: Generate fresh keys for the new node

Every new node needs its own identity.

You can generate them with a small Go program (example):

```bash
# Create a simple key generator (run from avalanchego dir)
cat > /tmp/gen_node_keys.go << 'EOF'
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/staking"
	"github.com/ava-labs/avalanchego/utils/crypto/bls/signer/localsigner"
	"github.com/ava-labs/avalanchego/vms/platformvm/signer"
)

func main() {
	dir := "new-node-staking"
	os.MkdirAll(dir, 0755)

	certPEM, keyPEM, _ := staking.NewCertAndKeyBytes()
	os.WriteFile(filepath.Join(dir, "staker.crt"), certPEM, 0644)
	os.WriteFile(filepath.Join(dir, "staker.key"), keyPEM, 0600)

	tlsCert, _ := tls.X509KeyPair(certPEM, keyPEM)
	if tlsCert.Leaf == nil {
		tlsCert.Leaf, _ = x509.ParseCertificate(tlsCert.Certificate[0])
	}
	stakingCert, _ := staking.ParseCertificate(tlsCert.Leaf.Raw)
	nodeID := ids.NodeIDFromCert(stakingCert)
	fmt.Println("NodeID:", nodeID)

	blsSk, _ := localsigner.New()
	os.WriteFile(filepath.Join(dir, "signer.key"), blsSk.ToBytes(), 0600)

	pop, _ := signer.NewProofOfPossession(blsSk)
	fmt.Println("BLS Pubkey:", hex.EncodeToString(pop.PublicKey[:]))
	fmt.Println("Keys written to", dir)
}
EOF
go run /tmp/gen_node_keys.go
```

This produces a new `new-node-staking/` directory with fresh files.

### Step 2: Start the new node pointing at an existing one

```bash
./build/avalanchego \
  --network-id=titan \
  --data-dir=/path/to/new/data \
  --db-dir=/path/to/new/data/db \
  --log-dir=/path/to/new/data/logs \
  --http-host=0.0.0.0 \
  --http-port=9650 \
  --staking-port=9651 \
  --public-ip=YOUR_PUBLIC_IP \
  --staking-tls-cert-file=/path/to/new-node-staking/staker.crt \
  --staking-tls-key-file=/path/to/new-node-staking/staker.key \
  --staking-signer-key-file=/path/to/new-node-staking/signer.key \
  --bootstrap-ips=FIRST_NODE_PUBLIC_IP:9651 \
  --bootstrap-ids=NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8 \
  --http-allowed-hosts="*"
```

You can list multiple `--bootstrap-ips` / `--bootstrap-ids` for redundancy.

### Step 3: Become a validator (after the node is healthy)

Once the new node is fully bootstrapped and healthy:

1. Fund the new node’s P-Chain address with TITAN (transfer from the initial allocation or from another address).
2. Issue an `AddPermissionlessValidatorTx` (recommended) using the Platform API or a wallet.

Example using the API (after you have funds):

```bash
# Get the new node’s BLS info (it will print its own)
curl -X POST ... info.getNodeID
```

Then call `platform.addPermissionlessValidator` (or use `avalanche` CLI / custom tooling) with the new NodeID, BLS proof, start/end time, stake amount, reward address, etc.

The exact transaction is the same as on any Avalanche-style network.

## Production Recommendations

- Use a reverse proxy or firewall for the HTTP API (9650). Consider exposing only to trusted IPs or using auth.
- Run behind a process manager (systemd, docker, pm2, etc.).
- Monitor disk (the chain will grow), CPU, memory, and uptime.
- Back up the staking keys of every validator (loss = you can no longer validate with that identity).
- For high availability, run several nodes and keep at least one as a stable bootstrap beacon.
- Consider putting the genesis bootstrap keys on multiple machines that all declare the same NodeID (only one can be active at a time).

## Regenerating / Changing the Genesis

If you ever want to change the initial validator set, token distribution, start time, etc.:

1. Generate new staking material + BLS proof.
2. Edit (or regenerate) `avalanchego/genesis/genesis_titan.json`.
3. Rebuild the binary.
4. All nodes must start from a clean database with the new genesis.

## Current Genesis Validator (for reference)

- NodeID: `NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8`
- Use the keys from the original `titan-staking/` directory (securely copied).

Happy validating on Titan!