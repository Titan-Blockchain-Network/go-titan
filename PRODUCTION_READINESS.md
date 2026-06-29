# Production readiness checklist

Track progress toward a controlled private L1 (Phase A) and a public / DeFi-facing network (Phase B). Check items when done; link PRs or issues in the Notes column as needed.

**Current baseline (Phase 1 economics):** 65+ Titan CLI unit tests, CI lint/build/smoke, gosec (HIGH gate) + Trivy (OS) + govulncheck (informational), modular economics config (fee share and satellite disabled on-chain).

---

## Phase A — CI and test coverage

Raise comfort for development and trusted-operator networks.

### CI pipeline

- [x] Add `go test ./genesis/... -run Economics` to `ci.yml`
- [x] Add `go test ./core/... -run 'Titan|StateTransitionParams'` to `ci.yml` (coreth job or matrix step)
- [x] Run `avalanchego/scripts/smoke-test.sh` in CI (genesis create → apply → build → fingerprint)
- [x] Add `cache-dependency-path: avalanchego/go.sum` to lint job `setup-go` (remove cache warning)
- [x] Optional: `docker-local.sh up` smoke job (localhost node, health check, teardown) — CI `integration` job on main / workflow_dispatch

### Integration tests (live node)

- [x] Docker-local bootstrap: node starts and `/ext/health` returns healthy
- [x] `validator add` (or `provider onboard`): validator appears in `platform.getCurrentValidators`
- [x] E2E four-validator network: bootstrap + 3 providers via `provider onboard` (`scripts/e2e-four-validators.sh`)
- [x] `stake add`: delegator weight increases on target validator
- [x] `titan status`: shows validator uptime, delegation fee, potential reward after registration
- [x] C→P funding path: treasury can fund validator registration without manual intervention
- [x] Idempotent `genesis apply` on already-configured network (regression)

### Unit test gaps

- [x] `transfer_test.go` — C→P base fee parsing and error paths
- [x] `export_path_test.go` — `verify-export` / validator-add readiness
- [x] `provider_ops_test.go` — arg forwarding to `validator add`
- [x] Post-registration on-chain assertions (delegation fee matches `--delegation-fee` flag)

---

## Phase A — Security hardening

Move from awareness to enforcement.

### Static analysis

- [x] Remove `-no-fail` from gosec (or fail CI on HIGH/CRITICAL in `cmd/titan`)
- [x] Pin `securego/gosec` to a release tag (not `@master`)
- [x] Add `govulncheck ./avalanchego/cmd/titan/...` to `security.yml` (informational until Go/stdlib bump)
- [ ] Extend gosec scope incrementally (document exclusions for upstream paths)

### Container and supply chain

- [x] Document Trivy policy: OS-only gate vs optional library scan (`exit-code: 0` informational)
- [ ] Re-enable container build/push when ready; verify Cosign signatures
- [ ] Pin base image digests in `Dockerfile` / `Dockerfile.dless`
- [ ] Secret scanning: ensure `*.key`, `staker.key`, `signer.key` never committed (pre-commit or GitHub secret scan)

### Runtime and operations

- [ ] Production nodes use `--restrict-api` (localhost-only API)
- [ ] Origin server (`:9652`): TLS, rate limits, path whitelist verified under load
- [ ] Treasury / master keys: documented backup, rotation, and least-privilege access
- [ ] Staking keys: chmod 600, offline backup, never in git

---

## Phase B — Economics on-chain (fee share)

Config exists; routing is not active until these are done.

### C-chain fee distribution

- [ ] Deploy reward-pool contract (or Flare Distribution `0x1000…0004`) in C-chain genesis
- [ ] Implement coreth routing: `feeDistribution.enabled` → % of base fee to pool
- [ ] Unit tests: fee split math matches `CChainBaseFeeToValidatorsPercent`
- [ ] Integration test: N txs → measurable pool balance increase
- [ ] Document burn vs validator share in `ECONOMICS.md` after enablement
- [ ] Governance or admin path to change % post-launch (or document rebuild requirement)

### P-chain fee distribution (optional)

- [ ] Design P-chain fee recycle (precompile or periodic treasury script)
- [ ] Set `pChainTxFeeToValidatorsPercent` default and enable criteria
- [ ] Tests for P-chain fee accounting

### Provider earnings validation

- [ ] End-to-end: provider stake → minting rewards accrue to reward address (with good uptime)
- [ ] End-to-end: delegator `stake add` → validator receives delegation fee cut
- [ ] Uptime below 80%: document expected reward reduction (manual or automated check)
- [ ] Treasury subsidy playbook: explicit P-chain transfers separate from staking rewards

---

## Phase B — Satellite / FTSO oracle

### Genesis and contracts

- [ ] Deploy Daemon (`0x1000…0002`) bytecode in C-chain genesis
- [ ] Deploy FTSO (`0x1000…0003`) bytecode in C-chain genesis
- [ ] Rename or split `state-connector.hex` vs Warp precompile (`0x0200…0005`) — clarify naming
- [ ] Set `satelliteOracle.enabled: true` in `genesis_titan.go` when contracts live
- [ ] Configure default attestor set or `SC_LOCAL_ATTESTATORS` for dev

### CLI and node software

- [ ] `--satellite` persists on-chain metadata (not just pre-tx validation)
- [ ] Oracle submission daemon/process (price feeds from `feedIds` config)
- [ ] `titan satellite status` — feed participation, accuracy, rewards
- [ ] Slashing / deviation thresholds (config + tests)
- [ ] Integration test: satellite validator submits feed → median updates

### Rewards

- [ ] Define data rewards pool source (inflation allocation vs fee share vs dApp usage fees)
- [ ] Tests: reward split weighted by stake and submission quality

---

## Phase B — Inherited codebase risk

Large surface from AvalancheGo + Coreth + go-flare fork.

- [ ] Inventory Titan-specific diffs vs upstream AvalancheGo (document in repo)
- [ ] Add `IsFlareFamilyCode()` / Granite params for Titan if needed
- [ ] Run targeted coreth tests on PRs touching `coreth/core/`
- [ ] Schedule dependency bumps (Go, libevm, avalanchego modules)
- [ ] External security review before public mainnet with significant TVL

---

## Phase B — Documentation and operator readiness

- [ ] `ECONOMICS.md` reflects enabled features only (no “disabled” items presented as live)
- [ ] `TITAN_DEPLOY.md` runbook: bootstrap → join → onboard → delegate → verify
- [ ] Incident runbook: node down, below-uptime, treasury key compromise, genesis mismatch
- [ ] Parameter change runbook: what requires rebuild vs on-chain governance
- [ ] Provider onboarding SLA: stake amount, duration, delegation fee, satellite requirements

---

## Quick reference — test commands

```sh
# Titan CLI (CI equivalent)
cd avalanchego && ./scripts/test-titan.sh --sequential

# Genesis economics
go test ./genesis/... -count=1 -run Economics

# Coreth Titan wiring
cd ../coreth && go test ./core/... -count=1 -run 'Titan|StateTransitionParams'

# Smoke (CI job: smoke)
cd avalanchego && ./scripts/smoke-test.sh

# Local node
cd .. && ./docker/docker-local.sh up && ./docker/docker-local.sh status

# Live integration (docker-local + validator/stake)
cd avalanchego && ./scripts/integration-test.sh

# E2E: developer bootstrap + 3 providers (4 validators)
cd avalanchego && ./scripts/e2e-four-validators.sh
```

---

## Risk comfort targets

| Milestone | Target | Key checklist sections |
|-----------|--------|------------------------|
| Dev / internal testnet | ~7/10 → 8/10 | Phase A CI + smoke |
| Trusted provider network | ~5/10 → 7/10 | Phase A integration + security hardening |
| Public / DeFi + oracles | ~3/10 → 8/10 | Phase B economics + FTSO + external review |

---

## Notes

| Item | PR / issue | Date |
|------|------------|------|
| Phase 1 economics foundation | `feature/provider-economics-phase1` | |
| Phase A CI + unit tests | `feature/provider-economics-phase1` | 2026-06-28 |
| Phase A live integration | `feature/provider-economics-phase1` | 2026-06-28 |
| | | |