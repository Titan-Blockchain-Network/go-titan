import { Chess, type Color } from 'chess.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { EscrowOutcome, TITAN_CHESS_ESCROW_ABI } from '@/lib/escrow-abi';
import { ESCROW_ADDRESS } from '@/lib/escrow-config';
import { TITAN_NETWORK } from '@/lib/titan-config';

const GAME_STATUS_ACTIVE = 0;

export function outcomeFromFen(fen: string, playerColor: Color): EscrowOutcome | null {
  const chess = new Chess(fen);
  if (!chess.isGameOver()) return null;
  if (chess.isDraw()) return EscrowOutcome.Draw;
  if (chess.isCheckmate()) {
    const playerWon =
      (chess.turn() === 'w' && playerColor === 'b') ||
      (chess.turn() === 'b' && playerColor === 'w');
    return playerWon ? EscrowOutcome.PlayerWins : EscrowOutcome.StockfishWins;
  }
  return EscrowOutcome.Draw;
}

function titanChain() {
  return {
    id: TITAN_NETWORK.chainId,
    name: TITAN_NETWORK.name,
    nativeCurrency: TITAN_NETWORK.nativeCurrency,
    rpcUrls: { default: { http: [TITAN_NETWORK.rpcUrl] } },
  } as const;
}

export async function settleEscrowOnChain(input: {
  gameId: bigint;
  outcome: EscrowOutcome;
  playerAddress: Address;
  fen: string;
  playerColor: Color;
}): Promise<{ txHash: Hex }> {
  if (!ESCROW_ADDRESS) {
    throw new Error('Escrow address not configured');
  }

  const derived = outcomeFromFen(input.fen, input.playerColor);
  if (derived == null || derived !== input.outcome) {
    throw new Error('Outcome does not match board state');
  }

  const pk = process.env.STOCKFISH_OPERATOR_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('Operator key not configured on server');
  }

  const chain = titanChain();
  const transport = http(TITAN_NETWORK.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(pk as Hex);
  const walletClient = createWalletClient({ account, chain, transport });

  const [player, , , status] = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'getGame',
    args: [input.gameId],
  });

  if (Number(status) !== GAME_STATUS_ACTIVE) {
    throw new Error('Game is not active');
  }

  if (player.toLowerCase() !== input.playerAddress.toLowerCase()) {
    throw new Error('Player does not own this game');
  }

  const operator = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'stockfishOperator',
  });

  if (operator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('Server operator key does not match contract operator');
  }

  const hash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'reportResult',
    args: [input.gameId, input.outcome],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return { txHash: hash };
}