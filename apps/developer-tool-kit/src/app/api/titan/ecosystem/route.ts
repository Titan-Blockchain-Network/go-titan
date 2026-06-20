import { NextResponse } from "next/server";

import { readChessEscrowSnapshot } from "@/lib/titan/chess-escrow-read";
import { cChainRpc } from "@/lib/titan/c-chain-rpc";
import { getTitanEcosystemConfig } from "@/lib/titan/ecosystem-config";
import { getNetworkMeshSnapshot } from "@/lib/titan/network-mesh-snapshot";

export const dynamic = "force-dynamic";

interface BlockSummary {
  number: string;
  hash: string;
  timestamp: string;
  txCount: number;
  gasUsed: string;
}

export async function GET() {
  const ecosystem = getTitanEcosystemConfig();

  try {
    const [network, chessEscrow] = await Promise.all([
      getNetworkMeshSnapshot(),
      ecosystem.chessEscrowAddress
        ? readChessEscrowSnapshot(ecosystem.chessEscrowAddress).catch(() => null)
        : Promise.resolve(null),
    ]);

    const head = Number.parseInt(network.blockNumber, 10) || 0;
    const recentBlocks: BlockSummary[] = [];

    for (let i = 0; i < 6 && head - i >= 0; i++) {
      const num = head - i;
      const block = await cChainRpc<{
        number: string;
        hash: string;
        timestamp: string;
        gasUsed: string;
        transactions: unknown[];
      }>("eth_getBlockByNumber", [`0x${num.toString(16)}`, false]).catch(() => null);

      if (!block) continue;
      recentBlocks.push({
        number: String(num),
        hash: block.hash,
        timestamp: String(Number.parseInt(block.timestamp, 16)),
        txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
        gasUsed: String(Number.parseInt(block.gasUsed, 16)),
      });
    }

    return NextResponse.json({
      ok: true,
      fetchedAt: Date.now(),
      network,
      recentBlocks,
      chessEscrow,
      apps: {
        chessUrl: ecosystem.chessAppUrl,
        chessEscrowConfigured: Boolean(ecosystem.chessEscrowAddress),
        chessEscrowAddress: ecosystem.chessEscrowAddress,
      },
      docsRepoUrl: ecosystem.docsRepoUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Ecosystem snapshot failed",
      },
      { status: 500 },
    );
  }
}