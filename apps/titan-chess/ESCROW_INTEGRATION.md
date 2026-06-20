# Titan Chess × TitanChessEscrow

Human vs Stockfish wagers on Titan C-Chain using native TITAN.

## Architecture

```
Owner                         Escrow contract                    Operator wallet
  | depositHouse()  --------->|  houseBankroll (house pool)      |
  |                             |                                  |
Player                          |                                  |
  | joinQueue{stake} ---------->|  holds player stake              |
  |                             |  startNextMatch() (no ETH sent)  |
  |                             |<---------------------------------|
  |                             |  matches stake from houseBankroll|
  |        Titan Chess (Stockfish off-chain)                       |
  |                             |  reportResult(gameId, outcome)   |
  |                             |<---------------------------------|
  |<----------------------------|  player paid OR pot → house pool |
```

- **Owner** funds `houseBankroll` via `depositHouse()` (or payable constructor).
- **Player** stakes via `joinQueue()` — player funds sit in the contract.
- **Operator** only signs `startNextMatch()` / `reportResult()` (gas only) — house stake comes from the contract pool.
- **Player wins** → paid from contract. **Stockfish wins** → pot stays in `houseBankroll`. **Draw** → player refund + house stake back to pool.

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

## 3. Fund the house bankroll

After deploy, send TITAN to the contract's house pool (owner only):

```bash
# Via Contract Studio playground, or cast/curl:
# depositHouse() with value = e.g. 10 TITAN
```

Keep `houseBankroll >= maxStake` (or at least the largest expected wager). The constructor can also be **payable** to seed the pool on deploy.

## 4. Run the house (operator)

The operator wallet only needs **gas** — not per-match stake.

Stay connected in Titan Chess as `stockfishOperator` (or run a bot). The app **automatically** calls `startNextMatch()` when the queue has a player, the house pool can cover the stake, and no game is active.

After checkmate or draw, the operator wallet calls `reportResult(gameId, outcome)`:

| Result | `outcome` enum |
|--------|----------------|
| Human wins | `1` (PlayerWins) |
| Stockfish wins | `2` (StockfishWins) |
| Draw | `3` (Draw) |

## 5. Player flow

1. Connect wallet → **New Wagered Game** → **vs Stockfish** → pick stake.
2. Confirm `joinQueue` in MetaMask.
3. Wait for operator to start the match (usually seconds).
4. Play chess; on game end, operator settles on-chain.
5. Winner receives **both stakes** (2× stake).

## 6. Manual operator (curl)

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