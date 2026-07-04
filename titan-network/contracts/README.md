# C-chain system contract bytecode

Hex files here are injected into C-chain genesis by `titan genesis create` and `titan genesis apply` (`injectStakingContracts` in `avalanchego/cmd/titan/staking_contract.go`).

| File | Predeploy address | Purpose |
|------|-------------------|---------|
| `warp-messenger.hex` | `0x1000000000000000000000000000000000000001` | Avalanche Warp messenger (L1 staking / warp flows) |
| `distribution.hex` | `0x1000000000000000000000000000000000000004` | Flare Distribution pool — receives C-chain base-fee share |

## Source

- **Warp messenger:** Titan L1 staking integration (project-specific build).
- **Distribution:** extracted from Flare mainnet genesis (`avalanchego/genesis/genesis_flare.json` alloc `0x1000…0004`). Used as the validator fee pool; 50% of each tx base fee is routed on-chain when `economicsConfig.feeDistribution.enabled` is true.

## Operator notes

- Both contracts must be present under `titan-network/contracts/` before `genesis create` / `genesis apply`, or injection fails.
- Changing bytecode or economics requires a **new genesis** and **wiping node DB volumes** — existing chains cannot pick up new predeploys in place.
- Inspect pool accrual: `eth_getBalance` on `0x1000000000000000000000000000000000000004` via C-chain RPC (`/ext/bc/C/rpc`).

## Related docs

- [avalanchego/cmd/titan/ECONOMICS.md](../../avalanchego/cmd/titan/ECONOMICS.md) — fee split and income sources
- [PRODUCTION_READINESS.md](../../PRODUCTION_READINESS.md) — rollout checklist