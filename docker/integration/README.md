# Integration test fixtures

Public Hardhat dev keys (never use on mainnet). Used only by `avalanchego/scripts/integration-test.sh`.

| File | Hardhat account | Role |
|------|-----------------|------|
| `treasury.key` | #0 | Treasury / validator registration |
| `delegator.key` | #2 | Delegator `stake add` |

Genesis: `titan-network/integration.origin.json` (network 888).

`docker/keys` staking identity is baked into `initialStakers` so a solo docker-local node can finalize P-chain blocks. Do not rotate `docker/keys` without updating the origin file.

### Treasury / delegator key hygiene

- Store `treasury.key` and `delegator.key` with `chmod 600`; never commit (gitignored).
- Treasury runs on the bootstrap node only; use a dedicated key per environment.
- Backup offline before genesis; rotation requires funding a new key and updating allocations in a new origin — not in-place on a live network.