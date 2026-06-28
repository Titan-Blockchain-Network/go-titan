# Validator economics

How Titan nodes earn tokens, what is locked, and which parameters operators can change.

## Income sources

| Source | Paid to | Mechanism |
|--------|---------|-----------|
| Staking rewards | Validator and delegator P-chain reward addresses | Protocol mints new TITAN (10–12% annual consumption rate) |
| Delegation fees | Validator reward address | Percent of delegator staking rewards (`--delegation-fee`) |
| Treasury stake | Reward address on the registration tx | `provider onboard` locks treasury tokens as validator weight; income is minting on that stake |

## Not validator income

| Item | Behavior |
|------|----------|
| P-chain transaction fees | Burned |
| C-chain gas | EVM fee market; not routed to P-chain validators by default |
| Locked stake principal | Returned when the stake period ends; not a payout |

## Token locking

Validator and delegator stake amounts are locked on the P-chain for the stake duration. Rewards are separate minted tokens paid to the configured reward address.

## Uptime

Validators must meet **80% uptime** (`UptimeRequirement` in `genesis/genesis_titan.go`) to receive full staking rewards. Check per-validator uptime with `titan status`.

## Adjustable parameters

### Network-wide (code change + rebuild)

File: `avalanchego/genesis/genesis_titan.go`

| Parameter | Default | Effect |
|-----------|---------|--------|
| `MinConsumptionRate` / `MaxConsumptionRate` | 10% – 12% annual | Minting rate for staking rewards |
| `UptimeRequirement` | 80% | Minimum uptime for full rewards |
| `MinValidatorStake` / `MaxValidatorStake` | 1 – 10,000 TITAN | Stake bounds |
| `MinDelegationFee` | 0% | Floor for `--delegation-fee` |
| `TxFee` | 0.001 TITAN | P-chain base fee (burned) |

### Per registration (CLI)

| Command | Flags | Effect |
|---------|-------|--------|
| `titan validator add` | `--amount`, `--duration-days`, `--delegation-fee` | Stake size, period, delegator fee share |
| `titan provider onboard` | same flags forwarded | Treasury funds and registers a join node |
| `titan stake add` | `--amount`, `--node-id` | Wallet delegation to a validator |

Default join-validator delegation fee: **0%** (matches genesis validator). Set explicitly when registering, for example `--delegation-fee 5`.

### Genesis bootstrap validator

Configured in `origin.json` / bootstrap: `rewardAddress`, `delegationFee` (default 0), locked allocation in `initialStakedFunds`.

## Typical flows

**Genesis validator**

1. Bootstrap locks genesis allocation as stake.
2. Rewards mint to `rewardAddress`.
3. Delegation fee 0% unless changed in genesis.

**Join / provider validator**

1. Treasury runs `titan provider onboard --from @treasury.key --uri http://JOIN:9650 --amount 2000 --delegation-fee 0`.
2. Treasury tokens are locked as that node's stake.
3. Minting rewards accrue to the treasury P-chain address on the registration tx.
4. Wallets may delegate with `titan stake add`; validator keeps `--delegation-fee` percent of delegator rewards.

**Wallet delegator**

1. `titan stake add --from @wallet.key --node-id NodeID-... --amount 100`
2. Wallet tokens locked for the validator's remaining stake period.
3. Minting rewards accrue to the wallet P-chain address minus validator delegation fee.

## Inspection

```sh
./avalanchego/build/titan status
```

Shows validators, weight, delegation fee, potential reward, uptime, and the economics block from genesis.

## Treasury subsidies

Fixed payouts from a genesis allocation wallet (outside minting) require explicit P-chain transfers from the treasury. `provider onboard` stakes treasury funds; it does not send unlocked salary tokens.