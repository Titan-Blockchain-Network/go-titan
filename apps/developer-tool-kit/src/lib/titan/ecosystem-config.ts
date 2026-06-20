/** Live ecosystem apps — set on Explorer (Vercel env). */
export interface TitanEcosystemConfig {
  chessEscrowAddress: `0x${string}` | null;
  chessAppUrl: string | null;
  docsRepoUrl: string;
}

function isAddress(value: string | undefined): value is `0x${string}` {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

export function getTitanEcosystemConfig(): TitanEcosystemConfig {
  const escrow =
    process.env.TITAN_CHESS_ESCROW_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_TITAN_CHESS_ESCROW_ADDRESS?.trim();

  const chessApp =
    process.env.NEXT_PUBLIC_TITAN_CHESS_URL?.trim() ||
    process.env.TITAN_CHESS_APP_URL?.trim() ||
    null;

  return {
    chessEscrowAddress: isAddress(escrow) ? escrow : null,
    chessAppUrl: chessApp || null,
    docsRepoUrl:
      process.env.TITAN_DOCS_REPO_URL?.trim() ||
      "https://github.com/Titan-Blockchain-Network/go-titan",
  };
}