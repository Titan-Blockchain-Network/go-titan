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

## Same Origin Guarantee (Critical for Join Nodes)

Every node must embed **identical** `genesis_titan.json` bytes. If the first node regenerates genesis locally, a plain `git clone` on join servers is **not** enough — they would build a different chain.

**Automatic fix (built into bootstrap):**

1. **First node** (`titan node bootstrap --first`) publishes an **origin bundle** to `$dataDir/titan-origin/`:
   - `anchor.json` — genesis hash, network ID, genesis NodeID
   - `genesis_titan.json` — exact file used to build the binary
2. A **`titan-origin` systemd service** serves that bundle on **port 9652** (open in ufw + cloud firewall).
3. **Join nodes** automatically run `titan genesis align --from http://ATLAS_IP:9652` before starting. This downloads genesis, rebuilds `avalanchego`, and **refuses to start** if the hash does not match.

**Firewall ports (first node / ATLAS):**

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 9651 | TCP | P2P staking (bootstrap) |
| 9650 | TCP | HTTP API (health, validator ops) |
| 9652 | TCP | Genesis origin bundle (join nodes download genesis here) |

Bootstrap applies these via `ufw` when you confirm firewall setup. You must also allow **9652/TCP** in your cloud provider security group. Join nodes only need 9651 + 9650 (they fetch origin outbound to ATLAS).

**Manual check:**

```bash
# On any machine — compare to first node
./build/titan genesis fingerprint
curl -s http://ATLAS_IP:9652/anchor.json | jq .genesisHash
# Hashes must match before the join node starts.
```

**Operational order:** ATLAS fully up first → then bootstrap join servers.

**Genesis key backup (first node only):** After keys are generated and genesis is aligned, bootstrap copies them to `/root/titan-genesis-backup/` (mode `0700`):

```
/root/titan-genesis-backup/
  staker.crt, staker.key, signer.key   # genesis validator identity
  genesis_titan.json                   # genesis used for this network
  anchor.json                          # fingerprint join nodes verify against
  backup-info.json                     # NodeID, genesis hash, timestamp
  README.txt
```

If you re-bootstrap and keys change, the previous backup is moved to `snapshots/<timestamp>/`. Copy the backup folder offline immediately.

Override with `titan node bootstrap --first --keys-backup-dir /path/to/backup`.

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

## Exact Mechanics: How a Node Actually Becomes a Validator (Source Review)

From reading the code:

1. **Node identity is derived only from files you pass on the command line**:
   - `--staking-tls-cert-file` + `--staking-tls-key-file` → NodeID (see `ids.NodeIDFromCert` + node/node.go:136)
   - `--staking-signer-key-file` → BLS signer → `info.getNodeID` returns the POP (node/node.go:1455, api/info/service.go)
   - These two must match exactly what is later recorded on the P-chain.

2. **Nothing in the node config "enables" validator status**.
   - `keystore.*` APIs were **deleted** (RELEASES v1.12.2, avalanchego#3657). `/ext/keystore` returns 404 on purpose.
   - Platform, info, health APIs are registered automatically by the VMs when the chains start (chains/manager.go + api/server).
   - No `--api-*-enabled` flag turns a node into a validator.

3. **The only thing that makes a NodeID a validator** is a record in P-chain state:
   - At genesis: `initialStakers` array in `genesis_titan.json` is turned into `PermissionlessValidator` entries (genesis/genesis.go:383), put into the P genesis, then loaded by `state.syncGenesis` → `PutCurrentValidator` (vms/platformvm/state/state.go:1743).
   - Later: someone with P-balance calls `IssueAddPermissionlessValidatorTx` (wallet) or submits a signed `AddPermissionlessValidatorTx`. This is executed and the staker appears in `GetCurrentValidators` (state + service.go).
   - The running node's health "bls" check does `vdrs.GetValidator(PrimaryNetworkID, myNodeID)` (node/node.go:1457). If missing → "node is not a validator".

4. **Why ATLAS showed as non-validator** (the concerning symptom):
   - Its on-disk staking files did not produce the NodeID that exists in the *currently loaded* P-chain genesis state.
   - Or the data directory was initialized with an older/different version of `genesis_titan.json`.
   - `getCurrentValidators` returned `[]` and the bls health check said "node is not a validator".

   Fix: use the **exact** files from `titan-staking/`, **wipe** the data dir, rebuild from current source, restart as the first node (`--bootstrap-ips=""`).

5. **For a second node (Prometheus)**: generate fresh keys, start it, move funds C→P using the wallet SDK (the two Go helpers), then issue the Add tx using the exact POP returned by **that node's own** `info.getNodeID`.

## Full "Add a Second Node + Make It a Validator" (Tested Against Actual Code)

Use the dedicated wrapper that calls the correct wallet code paths.

**On Prometheus-1 (the new node):**

```bash
# 1. Make sure source + genesis is up to date on this machine
cd ~/go-titan
# (scp or git pull the latest, including any genesis_titan.json changes)

cd avalanchego
./scripts/build.sh

# 2. Run the complete flow (transfer + register as validator)
# Get the hex private key from MetaMask for the funded C address first.
bash scripts/titan-add-validator.sh --privkey 0123456789abcdef... --amount 2000000
```

The script will:
- Print the real NodeID + POP that **this** node is advertising.
- Run the C→P transfer (IssueExport + IssueImport).
- Immediately issue AddPermissionlessValidatorTx using that exact POP.
- Give you the exact `curl` commands to verify from both machines.

**Verify from ATLAS (via SSH from Prometheus or directly):**

```bash
ssh root@165.22.0.208 '
  echo "=== ATLAS health (look for bls and C) ===";
  curl -s http://127.0.0.1:9650/ext/health | jq ".healthy, .checks.bls, .checks.C.error";
  echo "=== Current validators (should now show 2) ===";
  curl -s -X POST -H "Content-Type: application/json" --data '\''{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}'\'' http://127.0.0.1:9650/ext/bc/P | jq ".";
'
```

Also run the same `getCurrentValidators` and health locally on Prometheus after the script finishes.

**If ATLAS itself is still not listed:**

On ATLAS:
```bash
systemctl stop titan-atlas1 || true
rm -rf /root/titan-atlas1-data   # or the data dir you use
# Make sure titan-staking/ files (or the ones matching the genesis entry) are in the right place
cp /path/to/correct/staker.* /path/to/correct/signer.key /root/keys/   # example
cd ~/go-titan/avalanchego && ./scripts/build.sh
# Start again (empty bootstrap, the three staking flags pointing at the genesis-matching files)
```

Then wait for it to come up and check `platform.getCurrentValidators` again.

## Regenerating keys or changing the genesis validator

See the top of `scripts/gen-titan-keys.go --help` (or run it with `--genesis`). After editing `genesis_titan.json` you **must** rebuild and all nodes must use clean data directories.

Happy validating on Titan! (This procedure is now grounded in the actual platformvm genesis + AddPermissionlessValidator + node identity paths.)

## Security & Firewall (Critical)

Before starting the node on any server (especially after reset):

**Recommended (Ubuntu / DigitalOcean droplets - ufw):**

```bash
# As root
ufw allow 22/tcp comment 'SSH'

# Staking port - MUST be open for p2p (validators talk on this)
ufw allow 9651/tcp comment 'Titan staking'

# HTTP API (9650) - restrict it!
# For initial testing you can do:
# ufw allow 9650/tcp
# But for real use, only from your control machine:
ufw allow from YOUR_CONTROL_IP to any port 9650

ufw --force enable
ufw status verbose
```

To temporarily disable:
```bash
ufw disable
```

**Production notes:**
- Run API on 127.0.0.1 and access via SSH tunnel if possible: `ssh -L 9650:localhost:9650 root@server`
- Or put nginx in front with basic auth / IP allow.
- Never leave 9650 wide open on the public internet if avoidable.
- Keep staking (9651) public.

## Systemd Units (Persistence)

Use the CLI to generate them:

```bash
./build/titan node install-systemd \
  --name titan-atlas \
  --first \
  --data-dir /root/titan-data \
  --keys-dir /root/keys \
  --public-ip 165.22.0.208
```

This writes `/etc/systemd/system/titan-atlas.service`.

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now titan-atlas
journalctl -u titan-atlas -f
```

For additional nodes use `--name titan-prometheus1` (without `--first`) and fill in the bootstrap IPs/IDs in the generated unit or edit it.

A template is also at `avalanchego/scripts/titan-node.service.template`.

## Full Lifecycle: First Validator + Adding As Many Nodes As You Want (Minimal Manual Work)

The goal is one well-defined custom blockchain (Titan, ID 888) where:
- The first node is the **genesis validator** (baked into genesis).
- Every additional node is a normal permissionless validator added via on-chain tx.
- Tooling (`build/titan`) removes as much manual work as possible.

### 1. The Very First Validator (Genesis Bootstrapper)

This is special. It does **not** run `titan validator add`.

It becomes a validator because its NodeID + BLS POP + reward address are hardcoded in `genesis_titan.json` under `initialStakers`.

**Exact code path (from source):**
- `genesis/genesis.go` turns the `initialStakers` entry into a genesis `PermissionlessValidator`.
- `vms/platformvm/state/state.go:syncGenesis` loads it as a `CurrentStaker` at chain start.
- No separate tx is ever issued for it.
- The node must be started with **exactly** the staking keys that produce that NodeID and POP.
- Start with `--bootstrap-ips="" --bootstrap-ids=""` (it is the root of trust).

**With the new tooling (recommended):**

On the machine that will be the first node (e.g. ATLAS):

```bash
cd ~/go-titan/avalanchego
./scripts/build-titan.sh          # builds both avalanchego and the titan CLI

# Use the committed genesis keys (titan-staking/ at repo root)
./build/titan node setup --first --keys-dir ../titan-staking --public-ip=YOUR_PUBLIC_IP
```

This prints the exact command to run the node (with empty bootstrap, correct key flags, proper dirs).

Copy the keys if they are not in the suggested location:
```bash
mkdir -p /root/keys
cp ../titan-staking/* /root/keys/
chmod 600 /root/keys/*.key
```

Then run the printed `avalanchego` command (or put it in systemd).

After it starts:
```bash
./build/titan status
curl -s http://127.0.0.1:9650/ext/bc/P ... platform.getCurrentValidators
# You should see the genesis NodeID as a validator.
```

If it doesn't appear, your keys do not match the genesis (see `titan node setup --first` output for the expected NodeID).

### 2. Adding More Nodes (as many as you want)

**On the new machine:**

```bash
./build/titan node setup --join 165.22.0.208:9651 --bootstrap-id NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8
```

This tells you:
- Generate fresh keys: `titan keys generate --dir ./new-node-keys`
- Start command with the right `--bootstrap-ips` and `--bootstrap-ids`
- What NodeID/POP it will have (after you start it once and query its /ext/info)

**On a control machine that has access to the master funded private key (the 0x1b37... one):**

```bash
./build/titan validator add \
  --from @/secure/master-operator.key \
  --uri http://new-node-public-ip:9650 \
  --amount 2000000
```

Because we improved the CLI, it will:
- Automatically connect to the new node's API (`--uri`)
- Call `info.getNodeID` to get the exact current NodeID + POP
- Do the C→P transfer from the master key
- Issue the `AddPermissionlessValidatorTx`

No manual copy-paste of hex POPs needed.

**Verification (from anywhere):**

```bash
curl -s http://any-node:9650/ext/bc/P \
  -d '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' \
  | jq '.result.validators[] | select(.nodeID | contains("the-new-NodeID"))'
```

Both the genesis validator and all added ones will appear.

### 3. One Custom Blockchain, Many Nodes — Defined Outcome

- All nodes use the same `genesis_titan.json` (embedded at build time).
- The genesis validator is always the one in `initialStakers[0]`.
- Every other validator is added the same way via the P-chain.
- Use the same `titan` CLI everywhere.
- Fund movements and validator registration are now one `titan validator add` command.
- Keys are always generated the same way.
- Bootstrap is explicit via `--join`.

### Next-level reductions in manual work (future / you can extend)

- `titan node start` wrapper that auto-applies titan defaults and a config file.
- Auto-generation of systemd units: `titan node install-systemd`.
- A single "control plane" script that knows all current nodes and can mass-fund / mass-add.
- Pre-allocating a few smaller operator addresses in genesis (still using your preferred master-key model).

Run `./build/titan node help` and `./build/titan --help` after building to see the current commands.

## Reset Servers & Clean Launch (Recommended for you now)

Since you are resetting the two servers:

**Clean one-script flow after clone (the main path for ATLAS-1 etc.):**

```bash
git clone https://github.com/Titan-Blockchain-Network/go-titan.git
cd go-titan
./avalanchego/scripts/titan-server-bootstrap.sh
```

**One script sets everything up interactively** (assume you've cloned):

- apt-get update + all deps/Go/build
- Interactive prompts (say "yes" for first/genesis node on ATLAS-1)
- For clean first node: auto-generates keys + backs up to `/root/titan-genesis-backup` (previous copies go to `snapshots/`) + updates genesis + rebuilds
- Programmatic firewall
- Systemd + start
- Ends with healthcheck (verifies validator status)

No install.sh needed if cloned. This is the smooth "one run" for the titan network.

**For a completely bare server (nothing cloned yet):**

Use the one-liner:

```bash
curl -sSL https://raw.githubusercontent.com/Titan-Blockchain-Network/go-titan/main/install.sh | bash
```

(The install.sh will clone + run bootstrap.)

The script stops and asks for input at key points and ends with the healthcheck. This is the recommended single entry point after a server reset.

**ATLAS (first / genesis validator):**

Use the high-level bootstrap (does keys verify, config, **programmatic firewall**, systemd, start, and ends with healthcheck):

```bash
cd go-titan
./avalanchego/scripts/titan-server-bootstrap.sh
```

When prompted, answer that it is the first/genesis node. Requires root/sudo for firewall and systemd. The last step is the healthcheck.

**New node (after ATLAS is up):**

```bash
cd go-titan/avalanchego
./scripts/build-titan.sh

# Full automated join-node bootstrap (generates keys, writes bootstrap config, systemd, healthcheck)
./build/titan node bootstrap \
  --join ATLAS_IP:9651 \
  --bootstrap-id NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8 \
  --public-ip YOUR_IP \
  --keys-dir /root/keys \
  --name titan-prometheus1
```

Or step-by-step:

```bash
./build/titan keys generate --dir /root/keys
./build/titan node install-systemd \
  --name titan-prometheus1 \
  --join ATLAS_IP:9651 \
  --bootstrap-id NodeID-6X6AdU2gcAbgWciu9RvWctX45WYmtfzK8 \
  --public-ip YOUR_IP \
  --keys-dir /root/keys
sudo systemctl enable --now titan-prometheus1
```

**Fund + make it a validator (from control machine with master key):**

```bash
./build/titan validator add --from 0x...OR@file --uri http://new-node:9650 --amount 2000000
```

**Firewall on every server (run before or after):**

```bash
./build/titan node firewall
# then execute the printed ufw commands (adjust IPs)
```

**Verify:**

```bash
./build/titan status
curl -s http://localhost:9650/ext/bc/P -d '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators"}' | jq
```

This should now feel like a real, low-friction custom blockchain where adding nodes is a repeatable, documented process.

This gives you a clear, repeatable path from "empty repo clone" to "one running custom blockchain with N validators". The first is special (genesis), everything after is uniform (fund + register).