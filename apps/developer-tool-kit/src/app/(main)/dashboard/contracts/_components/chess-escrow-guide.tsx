"use client";

import { Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { APP_CONFIG } from "@/config/app-config";
import { shortAddress } from "@/lib/titan/format";

interface ChessEscrowGuideProps {
  contractAddress: string;
  operatorAddress?: string;
}

export function ChessEscrowGuide({ contractAddress, operatorAddress }: ChessEscrowGuideProps) {
  const envBlock = `NEXT_PUBLIC_ESCROW_ADDRESS=${contractAddress}
NEXT_PUBLIC_TITAN_RPC_URL=${APP_CONFIG.titan.rpcUrl}
NEXT_PUBLIC_TITAN_CHAIN_ID=${APP_CONFIG.titan.chainIdDec}
NEXT_PUBLIC_TITAN_CHAIN_ID_HEX=${APP_CONFIG.titan.chainIdHex}`;

  async function copyEnv() {
    try {
      await navigator.clipboard.writeText(envBlock);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-4 text-sm">
      <div>
        <p className="font-semibold text-amber-900 dark:text-amber-200">♟ Titan Chess integration</p>
        <p className="text-xs text-muted-foreground mt-1">
          Wire this escrow into <code className="font-mono">apps/titan-chess</code> so players stake TITAN against
          Stockfish. The house operator wallet starts matches and reports results on-chain.
        </p>
      </div>

      <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground">
        <li>
          Set <span className="font-mono text-foreground">stockfishOperator</span> to a funded wallet that runs the
          house (match starter + payout reporter).
          {operatorAddress && (
            <span className="block mt-0.5 font-mono text-foreground">{shortAddress(operatorAddress)}</span>
          )}
        </li>
        <li>Fund the operator wallet with enough TITAN to match player stakes (up to maxStake per game).</li>
        <li>
          Add env to titan-chess <span className="font-mono">.env.local</span> and redeploy the chess app.
        </li>
        <li>
          Connect the <strong>operator wallet</strong> in Titan Chess — it auto-calls{" "}
          <span className="font-mono">startNextMatch</span> when a player joins the queue.
        </li>
        <li>
          After each game, the operator calls <span className="font-mono">reportResult</span> (automated when that
          wallet is connected).
        </li>
      </ol>

      <pre className="rounded-md border bg-muted/40 p-3 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
        {envBlock}
      </pre>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void copyEnv()}>
          <Copy className="h-3.5 w-3.5" />
          Copy .env.local
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a
            href="https://github.com/Titan-Blockchain-Network/go-titan/blob/main/apps/titan-chess/ESCROW_INTEGRATION.md"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Full integration guide
          </a>
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Contract: <span className="font-mono break-all">{contractAddress}</span>
      </p>
    </div>
  );
}