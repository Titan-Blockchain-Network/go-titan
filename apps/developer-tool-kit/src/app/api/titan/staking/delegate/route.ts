import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { buildDelegatorStake } from "@/lib/titan/staking-tx-build";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      cAddress?: string;
      nodeId?: string;
      amountTitan?: number;
      days?: number;
    };

    const cAddress = body.cAddress?.trim();
    const nodeId = body.nodeId?.trim();
    const amountTitan = body.amountTitan;
    const days = body.days ?? 30;

    if (!cAddress || !isAddress(cAddress)) {
      return NextResponse.json({ error: "Invalid cAddress" }, { status: 400 });
    }
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }
    if (amountTitan == null || !Number.isFinite(amountTitan) || amountTitan <= 0) {
      return NextResponse.json({ error: "Invalid amountTitan" }, { status: 400 });
    }
    if (!Number.isFinite(days) || days < 1) {
      return NextResponse.json({ error: "Invalid delegation days" }, { status: 400 });
    }

    const result = await buildDelegatorStake({
      cAddress,
      nodeId,
      amountTitan,
      days,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delegate build failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}