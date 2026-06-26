# go-titan

Production-ready toolkit for launching and operating custom Avalanche L1 blockchains. Fork this repository, generate your genesis interactively, build the node binary, and deploy with Docker or bare metal.

Derived from [go-flare](https://github.com/flare-foundation/go-flare) (AvalancheGo v1.14 / Coreth v0.16).

## Project structure

```
go-titan/
├── avalanchego/          # Node + titan CLI (cmd/titan)
├── coreth/               # C-chain EVM
├── config/               # Chain configuration templates
├── docker/               # Docker Compose (bootstrap + provider modes)
├── titan-network/        # Your network genesis (origin.json — generated, not committed)
├── entrypoint/           # Distroless entrypoint (Go)
├── Dockerfile            # Standard image
└── Dockerfile.dless      # Distroless / rootless image
```

## Quick start

### 1. Create your genesis

```sh
git clone https://github.com/Titan-Blockchain-Network/go-titan.git
cd go-titan/avalanchego
./scripts/build-titan.sh

./build/titan genesis create
```

The interactive wizard asks for blockchain name, token ticker, chain ID, allocations, total supply, and optional initial validators. Output is saved to `titan-network/origin.json` (gitignored).

### 2. Apply genesis and build

```sh
./build/titan genesis apply
./scripts/build-titan.sh
```

`genesis apply` syncs `origin.json` → `avalanchego/genesis/genesis_titan.json`, **creates the network config** in `network_ids.go`, and injects the C-chain Warp Messenger contract. No manual code edits required.

### 3. Deploy bootstrap node

**Bare metal (recommended for production):**

```sh
./build/titan node bootstrap --first
```

**Docker (single-node bootstrap):**

```sh
# Generate keys first: ./build/titan keys generate --genesis --dir docker/keys
docker compose -f docker/docker-compose.bootstrap.yml up -d
```

### 4. Add provider (join) nodes

```sh
# On the join machine
./build/titan genesis align --from http://BOOTSTRAP_IP:9652
./build/titan keys generate --dir /path/to/keys
./build/titan node bootstrap --join BOOTSTRAP_IP:9651 --bootstrap-id NodeID-...
```

**Docker provider mode:**

```sh
BOOTSTRAP_IPS=1.2.3.4:9651 BOOTSTRAP_IDS=NodeID-... \
  docker compose -f docker/docker-compose.provider.yml up -d
```

## Titan CLI reference

| Command | Description |
|---------|-------------|
| `titan genesis create` | Interactive genesis wizard |
| `titan genesis apply` | Sync origin.json → genesis_titan.json |
| `titan genesis align --from URL` | Download genesis from bootstrap node |
| `titan genesis fingerprint` | Show embedded genesis hash |
| `titan keys generate [--genesis]` | Create staking TLS + BLS keys |
| `titan node bootstrap --first` | Full bootstrap node setup |
| `titan node bootstrap --join ...` | Join node setup |
| `titan provider onboard --from @key --uri URL` | Bootstrapper funds + registers join node |
| `titan validator add --from @key` | Register a validator on-chain |
| `titan stake add --from @key --node-id ID` | Delegate tokens to a validator |
| `titan status` | Validators, fees, rewards, health |

See [TITAN_DEPLOY.md](./TITAN_DEPLOY.md) for the complete operational guide.

## Docker

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_MODE` | _(empty)_ | `bootstrap` (genesis node) or `provider` (join node) |
| `NETWORK_ID` | `titan` | Network identifier |
| `BOOTSTRAP_IPS` | _(empty)_ | Bootstrap peer IPs |
| `BOOTSTRAP_IDS` | _(empty)_ | Bootstrap peer NodeIDs |
| `AUTOCONFIGURE_PUBLIC_IP` | `1` | Auto-detect public IP |
| `AUTOCONFIGURE_BOOTSTRAP` | `0` | Auto-discover bootstrap from endpoint |

Images are published to `ghcr.io/titan-blockchain-network/go-titan`. See [README-docker.md](./README-docker.md) for full configuration.

## Development

### Requirements

- Go 1.24+ and gcc (for CGO/BLS)
- jq, curl

**Do not use `apt install golang-go`** if it conflicts on your distro — use the repo installer instead:

```sh
# From repo root (or anywhere):
./avalanchego/scripts/install-dev.sh
export PATH="$HOME/.local/go/bin:$PATH"
```

### Build & test

If you are **already inside** `avalanchego/`, do not `cd avalanchego` again:

```sh
# From avalanchego/
go test ./cmd/titan/... -v
./scripts/build-titan.sh

# From repo root:
cd avalanchego && go test ./cmd/titan/... -v
```

### Full chain lifecycle

| Step | Command |
|------|---------|
| 1. Create genesis | `titan genesis create` → `titan genesis apply` → `build-titan.sh` |
| 2. Bootstrap node | `titan node bootstrap --first` |
| 3. Join node | `titan genesis align --from http://BOOTSTRAP:9652` then `titan node bootstrap --join ...` |
| 4. Onboard provider | On bootstrap: `titan provider onboard --from @treasury.key --uri http://JOIN:9650` |
| 5. Wallet delegates | `titan stake add --from @wallet.key --node-id NodeID-... --amount 100` |
| 6. Check rewards/fees | `titan status` (shows validators, fee config, reward rates) |

## CI/CD

GitHub Actions workflows (run when you push — not required for local dev):

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR to `main` | Titan CLI tests, golangci-lint, binary build |
| `security.yml` | push/PR + weekly | gosec + Trivy image scan |
| `build-container.yml` | push to `main`, tags | Multi-arch Docker images + Cosign |
| `release.yml` | `v*` tags | GitHub release with binaries |

**Run CI locally before pushing:**

```sh
cd avalanchego
go test ./cmd/titan/... -v          # unit tests (network creation, TLS, staking contract)
./scripts/build-titan.sh            # full build

# Optional lint (install golangci-lint first)
golangci-lint run ./cmd/titan/...
```

**Trigger CI on GitHub:** push your branch or open a PR against `main`. Workflows start automatically — check the Actions tab on the repo.

**Run a workflow manually on GitHub:** Actions → select `CI` or `Security` → **Run workflow** → choose branch → Run.

## Security

- `titan-network/origin.json` and staking private keys are gitignored
- Origin HTTP server uses path whitelisting, rate limiting, and security headers
- Use `--restrict-api` in production to bind HTTP to localhost
- Never commit `*.key`, `staker.crt`, or `signer.key`

## License

See [avalanchego/LICENSE](./avalanchego/LICENSE).