# go-titan

Toolkit for building and operating Avalanche L1 networks. Fork the repository, define genesis, compile node binaries, and deploy on bare metal or Docker.

Fork of [go-flare](https://github.com/flare-foundation/go-flare) (AvalancheGo v1.14 / Coreth v0.16).

## Project structure

```
go-titan/
├── avalanchego/          # AvalancheGo node and Titan CLI (cmd/titan)
├── coreth/               # C-chain EVM implementation
├── config/               # Chain configuration templates
├── docker/               # Docker Compose manifests and local dev scripts
├── titan-network/        # Network genesis source (origin.json)
├── entrypoint/           # Container entrypoint (distroless variant)
├── Dockerfile            # Standard container image
└── Dockerfile.dless      # Distroless rootless image
```

`origin.json` is operator-generated and excluded from version control. See `titan-network/origin.example.json` for the schema.

## Quick start

### 1. Genesis

```sh
git clone https://github.com/Titan-Blockchain-Network/go-titan.git
cd go-titan/avalanchego
./scripts/build-titan.sh

./build/titan genesis create
```

Prompts cover network name, token ticker, chain ID, allocations, supply, and optional genesis validators. Output: `titan-network/origin.json`.

**Chain ID:** `100000`–`999999999`. Values below `100000` are reserved by Avalanche (mainnet, Fuji, Local, etc.). The ID is used as both the Avalanche network ID and the C-chain EVM `chainId`. Invalid entries are rejected with a re-prompt.

### 2. Apply and build

```sh
./build/titan genesis apply
./scripts/build-titan.sh
```

`genesis apply` writes `avalanchego/genesis/genesis_titan.json`, patches `network_ids.go`, and injects the C-chain Warp Messenger precompile.

### 3. Bootstrap node

**Bare metal:**

```sh
./build/titan node bootstrap --first
```

**Docker (local development):**

```sh
./docker/docker-local.sh up
./docker/docker-local.sh status
./docker/docker-local.sh down
```

**Docker (production bootstrap):**

```sh
./build/titan keys generate --genesis --dir docker/keys
docker compose -f docker/docker-compose.bootstrap.yml up -d
```

### 4. Join nodes

```sh
./build/titan genesis align --from http://BOOTSTRAP_IP:9652
./build/titan keys generate --dir /path/to/keys
./build/titan node bootstrap --join BOOTSTRAP_IP:9651 --bootstrap-id NodeID-...
```

**Docker (provider):**

```sh
BOOTSTRAP_IPS=1.2.3.4:9651 BOOTSTRAP_IDS=NodeID-... \
  docker compose -f docker/docker-compose.provider.yml up -d
```

## Titan CLI

| Command | Description |
|---------|-------------|
| `titan genesis create` | Genesis configuration wizard |
| `titan genesis apply` | Apply `origin.json` to embedded genesis |
| `titan genesis align --from URL` | Fetch genesis from bootstrap origin server |
| `titan genesis fingerprint` | Embedded genesis hash |
| `titan keys generate [--genesis]` | Staking TLS and BLS keys |
| `titan node bootstrap --first` | Bootstrap node installation |
| `titan node bootstrap --join ...` | Join node installation |
| `titan provider onboard --from @key --uri URL` | Fund and register a join validator |
| `titan validator add --from @key` | Register validator on-chain |
| `titan stake add --from @key --node-id ID` | Delegate stake to a validator |
| `titan status` | Validators, fees, rewards, health |

Operational procedures: [TITAN_DEPLOY.md](./TITAN_DEPLOY.md).

## Docker

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_MODE` | _(empty)_ | `bootstrap` or `provider` |
| `NETWORK_ID` | `titan` | Network identifier |
| `BOOTSTRAP_IPS` | _(empty)_ | Bootstrap peer addresses |
| `BOOTSTRAP_IDS` | _(empty)_ | Bootstrap peer NodeIDs |
| `AUTOCONFIGURE_PUBLIC_IP` | `1` | Auto-detect public IP |
| `AUTOCONFIGURE_BOOTSTRAP` | `0` | Discover bootstrap peers from endpoint |

Images: `ghcr.io/titan-blockchain-network/go-titan`. Configuration reference: [README-docker.md](./README-docker.md).

## Development

### Requirements

- Go 1.24+, gcc (CGO/BLS)
- jq, curl

Install Go via `install-dev.sh` rather than distro `golang-go` packages when they conflict:

```sh
./avalanchego/scripts/install-dev.sh
export PATH="$HOME/.local/go/bin:$PATH"
```

### Build and test

```sh
cd avalanchego
./scripts/test-titan.sh
./scripts/test-titan.sh --sequential
./scripts/test-titan.sh --run TestValidateCustomChainID
./scripts/build-titan.sh
./scripts/smoke-test.sh
```

Test output is logged to `avalanchego/test-results/`. Suite layout: [avalanchego/cmd/titan/TESTING.md](./avalanchego/cmd/titan/TESTING.md).

### Lifecycle

| Step | Command |
|------|---------|
| Genesis | `titan genesis create` → `titan genesis apply` → `build-titan.sh` |
| Bootstrap | `titan node bootstrap --first` |
| Join | `titan genesis align --from http://BOOTSTRAP:9652` → `titan node bootstrap --join ...` |
| Onboard | `titan provider onboard --from @treasury.key --uri http://JOIN:9650` |
| Delegate | `titan stake add --from @wallet.key --node-id NodeID-... --amount 100` |
| Status | `titan status` |

## CI/CD

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | push/PR to `main` | `test-titan.sh`, golangci-lint, build |
| `security.yml` | push/PR, weekly | gosec, Trivy |
| `build-container.yml` | `main`, tags | Multi-arch images, Cosign |
| `release.yml` | `v*` tags | Release binaries |

Tests run from the repository root:

```sh
cd avalanchego && ./scripts/test-titan.sh --sequential
```

Local pre-push:

```sh
cd avalanchego
./scripts/test-titan.sh
./scripts/build-titan.sh
golangci-lint run --config .golangci-titan.yml ./cmd/titan/...
```

## Security

- `titan-network/origin.json` and staking key material are excluded from git
- Origin HTTP server: path whitelist, rate limits, security headers
- Production: `--restrict-api` binds HTTP to localhost
- Do not commit `*.key`, `staker.crt`, or `signer.key`

## License

See [avalanchego/LICENSE](./avalanchego/LICENSE).