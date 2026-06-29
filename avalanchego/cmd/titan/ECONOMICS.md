# Validator economics

How Titan nodes earn tokens, what is locked, and which parameters operators can change.

## Income sources

| Source | Status | Paid to | Mechanism |
|--------|--------|---------|-----------|
| Staking rewards | Active | Validator and delegator P-chain reward addresses | Protocol mints new TITAN (10–12% annual consumption rate) |
| Delegation fees | Active | Validator reward address | Percent of delegator staking rewards (`--delegation-fee`) |
| Treasury stake | Active | Reward address on the registration tx | `provider onboard` locks treasury tokens as validator weight |
| C-chain fee share | **Active** | Distribution pool `0x1000…0004` | 50% of base fee per tx (`feeDistribution.enabled`) |
| P-chain fee share | Phase 2 | Validator reward pool | Configured in `EconomicsConfig.feeDistribution` (default 0%, disabled) |
| Satellite oracle rewards | Phase 2 | Satellite validators | FTSO-style feeds; config in `EconomicsConfig.satelliteOracle` |

## C-chain fee split (active)

On Titan (chain ID 888), each C-chain transaction fee is split as follows:

| Portion | Destination | Share |
|---------|-------------|-------|
| Base fee | Distribution pool (`0x1000…0004`) | `cChainBaseFeeToValidatorsPercent` (default **50%**) |
| Base fee remainder + tips | Fee sink (`0x000…dEaD`) | Remaining 50% of base fee + all priority tips |

Routing is enforced in `coreth/core/fee_distribution.go` when `economicsConfig.feeDistribution.enabled` is true. The pool contract bytecode is predeployed at genesis (Flare Distribution implementation).

**Changing the percent today** requires updating `genesis/genesis_titan.go` (`EconomicsConfig`) and rebuilding nodes. On-chain governance for live parameter updates is planned for a later phase.

## Not validator income (today)

| Item | Behavior |
|------|----------|
| P-chain transaction fees | Burned until `feeDistribution.pChainTxFeeToValidatorsPercent` is enabled |
| Locked stake principal | Returned when the stake period ends |

## Phased rollout

### Phase 1 — foundation

- Modular `NetworkEconomicsConfig` in `genesis/genesis_titan.go`
- Titan wired into Flare C-chain state transition path (`coreth/core/state_transition_params.go`)
- C-chain genesis uses Flare system coinbase (`0x0100…`)
- `--satellite` flag on `validator add` / `provider onboard` (eligibility checks; contracts Phase 2)
- Economics displayed in `titan status`

### Phase 2 — in progress

- [x] Distribution pool (`0x1000…0004`) in C-chain genesis
- [x] `feeDistribution.enabled` and base-fee routing in coreth
- [ ] Daemon (`0x1000…0002`) and FTSO (`0x1000…0003`) system contracts
- [ ] `satelliteOracle.enabled` and oracle submission daemon
- [ ] Governance hooks for post-launch parameter updates

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
| `economicsConfig.feeDistribution` | 50% C-chain, **enabled** | Validator base-fee share to distribution pool |
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
cd ../coreth && go test ./core/... -run 'Titan|StateTransition|FeeDistribution' -count=1
```