# Titan apps (pnpm monorepo)

| App | Package | Port | Description |
|-----|---------|------|-------------|
| `developer-tool-kit` | `titan-explorer` | 3000 | Block explorer + network dashboard |
| `titan-chess` | `titan-chess` | 3001 | Wagered chess (RainbowKit + Stockfish) |

## Local dev

```bash
# from repo root
corepack enable && corepack prepare pnpm@9 --activate   # or: npm i -g pnpm
pnpm install

cp apps/.env.example apps/developer-tool-kit/.env.local
cp apps/.env.example apps/titan-chess/.env.local

pnpm dev:explorer   # http://localhost:3000
pnpm dev:chess      # http://localhost:3001
```

## Vercel — Explorer

1. Import repo → **Root Directory**: `apps/developer-tool-kit`
2. Framework: Next.js
3. Environment variables (from `apps/.env.example`):

```
TITAN_BOOTSTRAP_URL=https://rpc.titan-network.xyz
TITAN_NETWORK_NAME=Titan
TITAN_CHAIN_ID=888
TITAN_CHAIN_ID_HEX=0x378
NEXT_PUBLIC_TITAN_RPC_URL=https://rpc.titan-network.xyz/ext/bc/C/rpc
```

4. Custom domain: `explorer.titan-network.xyz`
5. In MetaMask network settings, set **Block explorer URL** to `https://explorer.titan-network.xyz`

## Vercel — Chess (separate project)

Root Directory: `apps/titan-chess` — same `NEXT_PUBLIC_TITAN_*` vars.

## Network defaults

Both apps default to **chain 888** and `https://rpc.titan-network.xyz/ext/bc/C/rpc` when env vars are unset (production builds). Local dev: override in `.env.local` with `http://127.0.0.1:9650`.