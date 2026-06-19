/** Titan mainnet defaults — override via env (see apps/.env.example). */
export const TITAN_NETWORK = {
  name: process.env.NEXT_PUBLIC_TITAN_NETWORK_NAME ?? 'Titan',
  chainId: Number.parseInt(process.env.NEXT_PUBLIC_TITAN_CHAIN_ID ?? '888', 10),
  chainIdHex: process.env.NEXT_PUBLIC_TITAN_CHAIN_ID_HEX ?? '0x378',
  rpcUrl:
    process.env.NEXT_PUBLIC_TITAN_RPC_URL ??
    'https://rpc.titan-network.xyz/ext/bc/C/rpc',
  explorerUrl:
    process.env.NEXT_PUBLIC_TITAN_EXPLORER_URL ?? 'https://explorer.titan-network.xyz',
  nativeCurrency: {
    decimals: 18,
    name: 'Titan',
    symbol: 'TITAN',
  },
} as const;