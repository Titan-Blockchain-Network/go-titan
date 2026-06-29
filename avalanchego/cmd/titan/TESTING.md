# Titan CLI test suite

Standard library `testing` package with table-driven tests.

## Run

```sh
cd avalanchego
./scripts/test-titan.sh
./scripts/test-titan.sh --run TestValidateCustomChainID
./scripts/test-titan.sh --sequential
./scripts/test-titan.sh --verbose-output

go test ./cmd/titan/... -count=1 -v   # plain output
```

Logs: `avalanchego/test-results/` (`latest.log` → most recent run).

## Layout

| File | Scope |
|------|-------|
| `genesis_validation_test.go` | Chain ID, addresses, amounts |
| `genesis_wizard_test.go` | Interactive prompts |
| `genesis_apply_test.go` | `genesis create` / `genesis apply` |
| `genesis_cchain_test.go` | C-chain genesis document |
| `network_config_test.go` | `network_ids.go` updates |
| `staking_contract_test.go` | Warp messenger + distribution pool injection |
| `validator_ops_test.go` | Validator stake bounds, delegation fee parsing |
| `delegator_ops_test.go` | Delegator stake validation |
| `fees_test.go` | Network economics vs `TitanParams` |
| `satellite_ops_test.go` | Satellite registration eligibility |
| `genesis_tls_test.go` | Origin HTTPS server |
| `deployment_docker_test.go` | Local Docker compose |

## Workflow

1. Add a failing test in the matching `*_test.go` file.
2. Implement the change in the corresponding source file.
3. Run `./scripts/test-titan.sh` or `go test ./cmd/titan/... -count=1`.
4. CI executes the same suite on push and pull requests (`.github/workflows/ci.yml`).

Integration: `avalanchego/scripts/smoke-test.sh`, `docker/docker-local.sh`, `avalanchego/scripts/integration-test.sh`.

```sh
# Live node (Docker): genesis apply → docker-local up → validator/stake assertions
cd avalanchego && ./scripts/integration-test.sh

# Or against an already-running node:
export TITAN_INTEGRATION=1 TITAN_NODE_URI=http://127.0.0.1:9650
go test -tags=integration ./cmd/titan/... -count=1 -v -run TestIntegrationLiveNetwork

# Full E2E: developer bootstrap + 3 providers → 4 validators
cd avalanchego && ./scripts/e2e-four-validators.sh
```