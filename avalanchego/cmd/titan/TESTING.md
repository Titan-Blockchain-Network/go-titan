# Titan CLI tests

Go's built-in `testing` package (table-driven tests). Run from `avalanchego/`:

```sh
./scripts/test-titan.sh                    # colored live console + log file
./scripts/test-titan.sh --run TestValidateCustomChainID
./scripts/test-titan.sh --sequential       # one test at a time (less mixed output)
./scripts/test-titan.sh --verbose-output   # show each test's stdout/stderr

# Plain Go output (CI-style):
go test ./cmd/titan/... -count=1 -v
```

Logs are written under `avalanchego/test-results/` (`latest.log` symlink points at the last run).

## Layout (by feature)

| File | Feature |
|------|---------|
| `genesis_validation_test.go` | Chain ID, addresses, token amounts |
| `genesis_wizard_test.go` | Interactive prompts (stdin injection) |
| `genesis_apply_test.go` | `genesis create` / `genesis apply` flows |
| `genesis_cchain_test.go` | C-chain genesis JSON |
| `network_config_test.go` | `network_ids.go` patching |
| `staking_contract_test.go` | Warp messenger injection |
| `genesis_tls_test.go` | Origin HTTPS server |
| `deployment_docker_test.go` | Local Docker compose contracts |

## TDD workflow

1. Add a failing test in the feature file that matches your change.
2. Implement the fix in the matching `.go` source file.
3. Run `go test ./cmd/titan/... -count=1`.
4. CI runs the same suite on push (`.github/workflows/ci.yml`).

Integration / smoke (build + docker up) stays in `avalanchego/scripts/smoke-test.sh` and `docker/docker-local.sh`.