# Validator economics

How Titan nodes earn tokens, what is locked, and which parameters operators can change.

## Income sources

| Source | Status | Paid to | Mechanism |
|--------|--------|---------|-----------|
| Staking rewards | Active | Validator and delegator P-chain reward addresses | Protocol mints new TITAN (10–12% annual consumption rate) |
| Delegation fees | Active | Validator reward address | Percent of delegator staking rewards (`--delegation-fee`) |
| Treasury stake | Active | Reward address on the registration tx | `provider onboard` locks treasury tokens as validator weight |
| C-chain fee share | Phase 2 | Validator reward pool | Configured in `EconomicsConfig.feeDistribution` (default 50%, disabled) |
| P-chain fee share | Phase 2 | Validator reward pool | Configured in `EconomicsConfig.feeDistribution` (default 0%, disabled) |
| Satellite oracle rewards | Phase 2 | Satellite validators | FTSO-style feeds; config in `EconomicsConfig.satelliteOracle` |

## Not validator income (today)

| Item | Behavior |
|------|----------|
| P-chain transaction fees | Burned until `feeDistribution.pChainTxFeeToValidatorsPercent` is enabled |
| C-chain base fees | Routed to fee sink (`0xdead`) on Flare execution path; validator share pending Phase 2 pool |
| Locked stake principal | Returned when the stake period ends |

## Phased rollout

### Phase 1 (current branch)

- Modular `NetworkEconomicsConfig` in `genesis/genesis_titan.go`
- Titan wired into Flare C-chain state transition path (`coreth/core/state_transition_params.go`)
- C-chain genesis uses Flare system coinbase (`0x0100…`)
- `--satellite` flag on `validator add` / `provider onboard` (eligibility checks; contracts Phase 2)
- Economics displayed in `titan status`

### Phase 2

- Deploy Daemon (`0x1000…0002`) and FTSO (`0x1000…0003`) system contracts in C-chain genesis
- Enable `feeDistribution.enabled` and reward-pool routing in coreth
- Enable `satelliteOracle.enabled` and oracle submission daemon
- Governance hooks for post-launch parameter updates

## Token locking

Validator and delegator stake amounts are locked on the P-chain for the stake duration. Rewards are separate minted tokens paid to the configured reward address.

## Uptime

Validators must meet **80% uptime** (`UptimeRequirement` in `genesis/genesis_titan.go`) to receive full staking rewards. Check per-validator uptime with `titan status`.

## Adjustable parameters

### Network-wide (`genesis/genesis_titan.go`)

| Parameter | Default | Effect |
|-----------|---------|--------|
| `MinConsumptionRate` / `MaxConsumptionRate` | 10% – 12% annual | Minting rate for staking rewards |
| `UptimeRequirement` | 80% | Minimum uptime for full rewards |
| `economicsConfig.feeDistribution` | 50% C-chain target, disabled | Future validator fee share |
| `economicsConfig.satelliteOracle` | min 2000 TITAN, disabled | FTSO satellite requirements |

### Per registration (CLI)

| Command | Flags | Effect |
|---------|-------|--------|
| `titan validator add` | `--amount`, `--duration-days`, `--delegation-fee`, `--satellite` | Stake, period, delegator fee, oracle provider |
| `titan provider onboard` | same flags forwarded | Treasury funds and registers a join node |
| `titan stake add` | `--amount`, `--node-id` | Wallet delegation to a validator |

## Typical flows

**Provider / satellite validator**

```sh
titan provider onboard --from @treasury.key --uri http://JOIN:9650 \
  --amount 2000 --delegation-fee 5 --satellite
```

**Wallet delegator**

```sh
titan stake add --from @wallet.key --node-id NodeID-... --amount 100
```

## Inspection

```sh
./avalanchego/build/titan status
```

Shows validators, economics config, delegation fees, potential rewards, and uptime.

## Configuration reference

Structs: `avalanchego/genesis/economics_config.go`

Tests:

```sh
cd avalanchego && go test ./genesis/... ./cmd/titan/... -count=1
cd ../coreth && go test ./core/... -run 'Titan|StateTransition' -count=1
```