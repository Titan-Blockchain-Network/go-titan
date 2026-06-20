import { type NextRequest, NextResponse } from 'next/server';
import { isAddress, type Address } from 'viem';

import { EscrowOutcome } from '@/lib/escrow-abi';
import { settleEscrowOnChain } from '@/lib/settle-escrow';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      gameId?: string;
      outcome?: number;
      fen?: string;
      playerColor?: 'w' | 'b';
      playerAddress?: string;
    };

    const gameId = body.gameId != null ? BigInt(body.gameId) : null;
    const outcome = body.outcome;
    const fen = body.fen?.trim();
    const playerColor = body.playerColor;
    const playerAddress = body.playerAddress?.trim();

    if (gameId == null || gameId < BigInt(0)) {
      return NextResponse.json({ error: 'Invalid gameId' }, { status: 400 });
    }
    if (
      outcome !== EscrowOutcome.PlayerWins &&
      outcome !== EscrowOutcome.StockfishWins &&
      outcome !== EscrowOutcome.Draw
    ) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 });
    }
    if (!fen || (playerColor !== 'w' && playerColor !== 'b')) {
      return NextResponse.json({ error: 'Missing fen or playerColor' }, { status: 400 });
    }
    if (!playerAddress || !isAddress(playerAddress)) {
      return NextResponse.json({ error: 'Invalid playerAddress' }, { status: 400 });
    }

    const { txHash } = await settleEscrowOnChain({
      gameId,
      outcome,
      fen,
      playerColor,
      playerAddress: playerAddress as Address,
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Settlement failed';
    const status =
      message.includes('not configured') ? 503 : message.includes('not match') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}