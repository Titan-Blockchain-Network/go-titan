import {
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  keccak256,
  toBytes,
  type Abi,
} from "viem";

import { cChainRpc } from "@/lib/titan/c-chain-rpc";

const CHESS_ESCROW_ABI = [
  {
    type: "function",
    name: "queueLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeGames",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "houseBankroll",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nextGameId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "MatchStarted",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchResolved",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "winner", type: "address", indexed: true },
      { name: "playerPayout", type: "uint256", indexed: false },
      { name: "houseReturn", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

const OUTCOME_LABELS = ["—", "Player wins", "Stockfish wins", "Draw"] as const;

const MATCH_STARTED_TOPIC = keccak256(toBytes("MatchStarted(uint256,address,uint256)"));
const MATCH_RESOLVED_TOPIC = keccak256(
  toBytes("MatchResolved(uint256,uint8,address,uint256,uint256)"),
);

type RawLog = {
  blockNumber: string;
  transactionHash: string;
  topics: `0x${string}`[];
  data: `0x${string}`;
};

export interface ChessEscrowSnapshot {
  address: `0x${string}`;
  queueLength: number;
  activeGames: number;
  houseBankroll: string;
  nextGameId: number;
  minStake: string;
  maxStake: string;
  recentMatches: Array<{
    kind: "started" | "resolved";
    gameId: string;
    player?: string;
    stake?: string;
    outcome?: string;
    winner?: string;
    blockNumber: string;
    txHash: string;
  }>;
}

async function ethCall(address: `0x${string}`, data: `0x${string}`): Promise<string> {
  return cChainRpc<string>("eth_call", [{ to: address, data }, "latest"]);
}

async function readUint(address: `0x${string}`, fn: string): Promise<bigint> {
  const data = encodeFunctionData({
    abi: CHESS_ESCROW_ABI,
    functionName: fn as "queueLength",
  });
  const hex = await ethCall(address, data);
  return BigInt(hex || "0x0");
}

async function fetchLogs(
  address: `0x${string}`,
  topic: `0x${string}`,
  fromBlock: string,
): Promise<RawLog[]> {
  return cChainRpc<RawLog[]>("eth_getLogs", [
    { address, fromBlock, toBlock: "latest", topics: [topic] },
  ]).catch(() => []);
}

export async function readChessEscrowSnapshot(
  address: `0x${string}`,
  logWindowBlocks = 8_000,
): Promise<ChessEscrowSnapshot> {
  const [queueLength, activeGames, houseBankroll, nextGameId, minStake, maxStake, headHex] =
    await Promise.all([
      readUint(address, "queueLength"),
      readUint(address, "activeGames"),
      readUint(address, "houseBankroll"),
      readUint(address, "nextGameId"),
      readUint(address, "minStake"),
      readUint(address, "maxStake"),
      cChainRpc<string>("eth_blockNumber", []),
    ]);

  const head = Number.parseInt(headHex, 16);
  const fromBlock = `0x${Math.max(0, head - logWindowBlocks).toString(16)}`;

  const [startedRaw, resolvedRaw] = await Promise.all([
    fetchLogs(address, MATCH_STARTED_TOPIC, fromBlock),
    fetchLogs(address, MATCH_RESOLVED_TOPIC, fromBlock),
  ]);

  const started = startedRaw.map((log) => {
    const decoded = decodeEventLog({ abi: CHESS_ESCROW_ABI, data: log.data, topics: log.topics });
    const args = decoded.args as { gameId?: bigint; player?: string; stake?: bigint };
    return {
      kind: "started" as const,
      gameId: String(args.gameId ?? 0),
      player: args.player,
      stake: args.stake != null ? formatEther(args.stake) : undefined,
      blockNumber: String(Number.parseInt(log.blockNumber, 16)),
      txHash: log.transactionHash,
    };
  });

  const resolved = resolvedRaw.map((log) => {
    const decoded = decodeEventLog({ abi: CHESS_ESCROW_ABI, data: log.data, topics: log.topics });
    const args = decoded.args as {
      gameId?: bigint;
      outcome?: number;
      winner?: string;
    };
    const outcomeIdx = Number(args.outcome ?? 0);
    return {
      kind: "resolved" as const,
      gameId: String(args.gameId ?? 0),
      outcome: OUTCOME_LABELS[outcomeIdx] ?? "Unknown",
      winner: args.winner,
      blockNumber: String(Number.parseInt(log.blockNumber, 16)),
      txHash: log.transactionHash,
    };
  });

  const recentMatches = [...started, ...resolved]
    .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber))
    .slice(0, 12);

  return {
    address,
    queueLength: Number(queueLength),
    activeGames: Number(activeGames),
    houseBankroll: formatEther(houseBankroll),
    nextGameId: Number(nextGameId),
    minStake: formatEther(minStake),
    maxStake: formatEther(maxStake),
    recentMatches,
  };
}