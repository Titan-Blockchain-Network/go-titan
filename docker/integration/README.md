# Integration test fixtures

Public Hardhat dev keys (never use on mainnet). Used by `avalanchego/scripts/integration-test.sh` and `e2e-four-validators.sh`.

| File | Hardhat account | Role |
|------|-----------------|------|
| `treasury.key` | #0 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Treasury / validator registration |
| `delegator.key` | #2 `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | Delegator `stake add` |

Genesis: `titan-network/integration.origin.json` (network 888).

`integration-test.sh` and `e2e-four-validators.sh` write these files when they are missing. They also generate `docker/keys` on a clean checkout and point genesis `initialStakers` at that NodeID (`tmp/integration.origin.json`). Do not rotate an existing `docker/keys` directory without updating the origin.

### Treasury / delegator key hygiene

- Store `treasury.key` and `delegator.key` with `chmod 600`; never commit (gitignored).
- Treasury runs on the bootstrap node only; use a dedicated key per environment.
- Backup offline before genesis; rotation requires funding a new key and updating allocations in a new origin — not in-place on a live network.