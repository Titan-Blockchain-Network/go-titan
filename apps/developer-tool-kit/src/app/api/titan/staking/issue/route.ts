import { NextRequest, NextResponse } from "next/server";

import { getPrimaryNodeBaseUrl } from "@/lib/titan/platform-rpc";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

export const dynamic = "force-dynamic";

async function issueOnChain(baseUrl: string, chain: "C" | "P", txHex: string): Promise<string> {
  const path = chain === "C" ? "/ext/bc/C/avax" : "/ext/bc/P";
  const method = chain === "C" ? "avax.issueTx" : "platform.issueTx";

  const res = await titanNodeFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: [{ tx: txHex, encoding: "hex" }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json()) as {
    result?: { txID?: string };
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message ?? `${method} failed`);
  }

  const txID = json.result?.txID;
  if (!txID) {
    throw new Error(`${method} returned no txID`);
  }

  return txID;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { txHex?: string; chain?: "C" | "P" };
    const txHex = body.txHex?.trim();
    const chain = body.chain;

    if (!txHex || !/^0x[0-9a-fA-F]+$/.test(txHex)) {
      return NextResponse.json({ error: "Invalid txHex" }, { status: 400 });
    }
    if (chain !== "C" && chain !== "P") {
      return NextResponse.json({ error: "chain must be C or P" }, { status: 400 });
    }

    const baseUrl = await getPrimaryNodeBaseUrl();
    const txID = await issueOnChain(baseUrl, chain, txHex);

    return NextResponse.json({ ok: true, txID });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Broadcast failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}