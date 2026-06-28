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
| `staking_contract_test.go` | Warp messenger injection |
| `genesis_tls_test.go` | Origin HTTPS server |
| `deployment_docker_test.go` | Local Docker compose |

## Workflow

1. Add a failing test in the matching `*_test.go` file.
2. Implement the change in the corresponding source file.
3. Run `./scripts/test-titan.sh` or `go test ./cmd/titan/... -count=1`.
4. CI executes the same suite on push and pull requests (`.github/workflows/ci.yml`).

Integration: `avalanchego/scripts/smoke-test.sh`, `docker/docker-local.sh`.