import { Chess, type Color } from 'chess.js';
import {
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
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

const titanChain = defineChain({
  id: TITAN_NETWORK.chainId,
  name: TITAN_NETWORK.name,
  nativeCurrency: TITAN_NETWORK.nativeCurrency,
  rpcUrls: {
    default: { http: [TITAN_NETWORK.rpcUrl] },
  },
});

type RpcResult<T> = {
  result?: T;
  error?: { message?: string };
};

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(TITAN_NETWORK.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const json = (await res.json()) as RpcResult<T>;

  if (json.error) {
    throw new Error(json.error.message ?? `${method} failed`);
  }
  if (json.result === undefined) {
    throw new Error(`${method} returned empty data`);
  }

  return json.result;
}

async function ethCall(data: Hex): Promise<Hex> {
  return rpcCall<Hex>('eth_call', [{ to: ESCROW_ADDRESS, data }, 'latest']);
}

type GetGameResult = readonly [
  Address,
  bigint,
  bigint,
  number,
  number,
  Address,
  bigint,
  bigint,
];

async function readGetGame(gameId: bigint): Promise<GetGameResult> {
  const data = encodeFunctionData({
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'getGame',
    args: [gameId],
  });
  const result = await ethCall(data);
  return decodeFunctionResult({
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'getGame',
    data: result,
  }) as GetGameResult;
}

async function readStockfishOperator(): Promise<Address> {
  const data = encodeFunctionData({
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'stockfishOperator',
  });
  const result = await ethCall(data);
  return decodeFunctionResult({
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'stockfishOperator',
    data: result,
  }) as Address;
}

function parseHexBigInt(value: Hex): bigint {
  return BigInt(value);
}

async function sendSignedTransaction(input: {
  account: ReturnType<typeof privateKeyToAccount>;
  to: Address;
  data: Hex;
}): Promise<Hex> {
  const [nonceHex, gasPriceHex, gasHex] = await Promise.all([
    rpcCall<Hex>('eth_getTransactionCount', [input.account.address, 'pending']),
    rpcCall<Hex>('eth_gasPrice', []),
    rpcCall<Hex>('eth_estimateGas', [
      {
        from: input.account.address,
        to: input.to,
        data: input.data,
      },
    ]),
  ]);

  const signed = await input.account.signTransaction({
    chainId: titanChain.id,
    nonce: Number(parseHexBigInt(nonceHex)),
    gas: parseHexBigInt(gasHex),
    gasPrice: parseHexBigInt(gasPriceHex),
    to: input.to,
    data: input.data,
    value: BigInt(0),
    type: 'legacy',
  });

  return rpcCall<Hex>('eth_sendRawTransaction', [signed]);
}

async function waitForTransactionReceipt(hash: Hex): Promise<void> {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const receipt = await rpcCall<null | { status: Hex }>('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.status !== '0x1') {
        throw new Error('Transaction reverted');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error('Transaction confirmation timed out');
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

  const account = privateKeyToAccount(pk as Hex);

  const [player, , , status] = await readGetGame(input.gameId);

  if (Number(status) !== GAME_STATUS_ACTIVE) {
    throw new Error('Game is not active');
  }

  if (player.toLowerCase() !== input.playerAddress.toLowerCase()) {
    throw new Error('Player does not own this game');
  }

  const operator = await readStockfishOperator();

  if (operator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('Server operator key does not match contract operator');
  }

  const calldata = encodeFunctionData({
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'reportResult',
    args: [input.gameId, input.outcome],
  });

  const hash = await sendSignedTransaction({
    account,
    to: ESCROW_ADDRESS,
    data: calldata,
  });

  await waitForTransactionReceipt(hash);

  return { txHash: hash };
}