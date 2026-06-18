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

### Generating the Origin (Genesis) Keys on Server 1

If you want to generate the very first bootstrapper keys directly on the production Server 1 (recommended for security):

```bash
# On Server 1
cd /path/to/go-titan/avalanchego
./scripts/gen-titan-keys.sh --genesis --dir=/opt/titan/genesis-keys
```

This will:
- Create the three key files locally on the server.
- Print the full `initialStakers` JSON block you would need if you ever rebuild the genesis.

**Note**: The current committed `genesis_titan.json` already contains one set of origin keys. If you generate a brand new set on Server 1, you must:
1. Update `initialStakers` in `avalanchego/genesis/genesis_titan.json`
2. Re-run `./scripts/build.sh`
3. Distribute the new binary + new genesis to all nodes

For most people it is simpler to just use the keys that were generated when the genesis was created (copy `titan-staking/` securely).

## First Node (Bootstrapper) Deployment

### 1. Build

```bash
cd avalanchego
./scripts/build.sh
```

The binary will be at `build/avalanchego`.

### 2. Prepare directories and keys

**Option A – Use pre-generated keys** (easiest if you already have the backup):

```bash
mkdir -p /opt/titan/data/db /opt/titan/data/logs /opt/titan/keys
cp staker.crt staker.key signer.key /opt/titan/keys/
chmod 600 /opt/titan/keys/staker.key /opt/titan/keys/signer.key
```

**Option B – Generate origin keys directly on Server 1** (air-gapped / high security):

```bash
cd avalanchego
./scripts/gen-titan-keys.sh --genesis --dir=/opt/titan/genesis-keys

# Then use the generated files:
cp /opt/titan/genesis-keys/* /opt/titan/keys/
```

After generation you will also see the JSON block printed — keep it if you plan to create a new genesis later.

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

## Generating Keys (Recommended Tool)

Titan ships with an official key generator:

```bash
cd avalanchego

# For a regular additional node
./scripts/gen-titan-keys.sh

# For the very first genesis bootstrapper (origin keys)
./scripts/gen-titan-keys.sh --genesis

# Custom location
./scripts/gen-titan-keys.sh --dir=/tmp/my-titan-keys --genesis
```

The script will:
- Write `staker.crt`, `staker.key`, and `signer.key`
- Print the NodeID
- Print the BLS public key + proof of possession
- When using `--genesis`, also print the exact JSON block to use in `initialStakers`

**Always run this on the target server** if you want the keys generated locally (especially useful for air-gapped or high-security Server 1).

---

## Adding More Nodes (Consecutive Nodes)

### Step 1: Generate fresh keys for the new node

Every additional node must use its own fresh keys:

```bash
cd avalanchego
./scripts/gen-titan-keys.sh --dir=/path/to/new-node-staking
```

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