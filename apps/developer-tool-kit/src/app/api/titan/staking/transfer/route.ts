import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { buildCtoPTransfer, buildPChainImport } from "@/lib/titan/staking-tx-build";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      cAddress?: string;
      amountTitan?: number;
      step?: "export" | "import";
    };

    const cAddress = body.cAddress?.trim();
    const step = body.step ?? "export";

    if (!cAddress || !isAddress(cAddress)) {
      return NextResponse.json({ error: "Invalid cAddress" }, { status: 400 });
    }

    if (step === "import") {
      const result = await buildPChainImport(cAddress);
      return NextResponse.json({ ok: true, ...result });
    }

    const amountTitan = body.amountTitan;
    if (amountTitan == null || !Number.isFinite(amountTitan) || amountTitan <= 0) {
      return NextResponse.json({ error: "Invalid amountTitan" }, { status: 400 });
    }

    const result = await buildCtoPTransfer(cAddress, amountTitan);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer build failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}