# Titan Chess × TitanChessEscrow

Human vs Stockfish wagers on Titan C-Chain using native TITAN.

## Architecture

```
Player wallet                    Escrow contract                 Operator wallet
     |                                 |                              |
     | joinQueue{value: stake}         |                              |
     |------------------------------->|  holds player stake          |
     |                                 |                              |
     |                                 | startNextMatch{value: stake} |
     |                                 |<-----------------------------|
     |                                 |  holds both stakes (pot)     |
     |                                 |                              |
     |        Titan Chess app (Stockfish off-chain)                   |
     |                                 |                              |
     |                                 | reportResult(gameId, outcome)|
     |                                 |<-----------------------------|
     |<-------------------------------|  pays winner (2× stake)       |
```

- **Player** stakes via `joinQueue()` — funds sit in the contract.
- **Operator** (`stockfishOperator`) matches the stake with `startNextMatch()` — opens the active game.
- **Operator** resolves with `reportResult()` after the off-chain chess match ends.
- **Draw** refunds each side their original stake.

## 1. Deploy the contract (Contract Studio)

1. Open [Contract Studio](https://explorer.titan-network.xyz/dashboard/contracts) on Titan Explorer.
2. Template: **TitanChessEscrow**.
3. Constructor:
   - `_stockfishOperator` — house wallet address (must sign `startNextMatch` + `reportResult`).
   - `_minStake` / `_maxStake` — wei bounds (template default: 0.01 – 1 TITAN).
4. Deploy with a funded MetaMask wallet on chain **888**.
5. Copy the deployed address.

## 2. Configure Titan Chess

`apps/titan-chess/.env.local`:

```env
NEXT_PUBLIC_TITAN_RPC_URL=https://rpc.titan-network.xyz/ext/bc/C/rpc
NEXT_PUBLIC_TITAN_CHAIN_ID=888
NEXT_PUBLIC_TITAN_CHAIN_ID_HEX=0x378
NEXT_PUBLIC_ESCROW_ADDRESS=0xYourDeployedEscrow
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_wc_project_id
```

```bash
cd apps/titan-chess
pnpm install
pnpm dev
```

## 3. Run the house (operator)

The operator wallet must:

1. Hold enough TITAN to **match** each queued stake (plus gas).
2. Stay connected in the Titan Chess UI (or run a custom bot calling the same functions).

When connected as `stockfishOperator`, the app **automatically** calls `startNextMatch()` when the queue has a player and no game is active.

After checkmate or draw, the operator wallet calls `reportResult(gameId, outcome)`:

| Result | `outcome` enum |
|--------|----------------|
| Human wins | `1` (PlayerWins) |
| Stockfish wins | `2` (StockfishWins) |
| Draw | `3` (Draw) |

## 4. Player flow

1. Connect wallet → **New Wagered Game** → **vs Stockfish** → pick stake.
2. Confirm `joinQueue` in MetaMask.
3. Wait for operator to start the match (usually seconds).
4. Play chess; on game end, operator settles on-chain.
5. Winner receives **both stakes** (2× stake).

## 5. Manual operator (curl)

For scripting without the UI:

```bash
# Peek queue (cast or curl eth_call)
# startNextMatch with value = queued stake
# reportResult(gameId, outcome)
```

See `contracts/TitanChessEscrow.sol` for the full ABI.

## Security notes

- Only `stockfishOperator` can start matches and report results — protect that key.
- Contract owner can `cancelActiveGame` if a match is stuck.
- Players can `leaveQueue()` before a match starts to reclaim stake.
- One active game at a time (FIFO queue) — suitable for a single-table house.

## For third-party builders

Copy `contracts/TitanChessEscrow.sol` or use the Contract Studio template. Replace Stockfish with your own off-chain game logic; keep the operator pattern: **stake on-chain, play off-chain, settle on-chain**.