import { parseWalletError } from "@/lib/titan/wallet-errors";
import {
  getCoreProvider,
  isCoreInstalled,
  listenForCoreProvider,
  type EthereumProvider,
} from "@/lib/titan/wallet-providers";

export {
  isCoreInstalled as hasAvalancheWallet,
  listenForCoreProvider as listenForAvalancheWallet,
};

export function getAvalancheWallet(): EthereumProvider | undefined {
  return getCoreProvider();
}

function ensure0xHex(txHex: string): string {
  const trimmed = txHex.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function extractTxId(result: unknown): string | null {
  if (typeof result === "string" && result.length > 0) return result;
  if (!result || typeof result !== "object") return null;

  const record = result as Record<string, unknown>;
  for (const key of ["txHash", "txID", "txId", "hash"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function formatAttemptError(error: unknown): string {
  return parseWalletError(error, "Unknown wallet error");
}

async function broadcastViaExplorer(txHex: string, chain: "C" | "P"): Promise<string> {
  const res = await fetch("/api/titan/staking/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHex, chain }),
  });
  const json = (await res.json()) as { txID?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? "Node refused to broadcast the signed transaction.");
  }
  if (!json.txID) {
    throw new Error("Node broadcast succeeded but returned no transaction ID.");
  }
  return json.txID;
}

/** Issue a signed or wallet-signable atomic tx via Avalanche Core (or compatible extension). */
export async function issueAtomicTx(txHex: string, chain: "C" | "P" | "X"): Promise<string> {
  const wallet = getAvalancheWallet();
  if (!wallet) {
    throw new Error(
      "Avalanche Core wallet not detected. Install Core (core.app) or use the CLI with your operator key.",
    );
  }

  const transactionHex = ensure0xHex(txHex);
  const errors: string[] = [];

  const sendAttempts: Array<{ method: string; params: unknown }> = [
    {
      method: "avalanche_sendTransaction",
      params: { transactionHex, chainAlias: chain },
    },
    {
      method: "avalanche_sendTransaction",
      params: [transactionHex, chain],
    },
    {
      method: "avalanche_sendTransaction",
      params: [{ transactionHex, chainAlias: chain }],
    },
    { method: "wallet_issueTx", params: { tx: transactionHex, chainAlias: chain } },
    { method: "wallet_issueTx", params: [{ tx: transactionHex, chainAlias: chain }] },
    { method: "avax_issueTx", params: { tx: transactionHex, chainAlias: chain } },
  ];

  for (const attempt of sendAttempts) {
    try {
      const result = await wallet.request(attempt);
      const txId = extractTxId(result);
      if (txId) return txId;
      errors.push(`${attempt.method}: empty response (${JSON.stringify(result)})`);
    } catch (error) {
      errors.push(`${attempt.method}: ${formatAttemptError(error)}`);
    }
  }

  if (chain === "P" || chain === "X") {
    const signAttempts: Array<{ method: string; params: unknown }> = [
      {
        method: "avalanche_signTransaction",
        params: { transactionHex, chainAlias: chain },
      },
      {
        method: "avalanche_signTransaction",
        params: [transactionHex, chain],
      },
    ];

    for (const attempt of signAttempts) {
      try {
        const result = await wallet.request(attempt);
        const signed =
          result && typeof result === "object" && "signedTransactionHex" in result
            ? String((result as { signedTransactionHex: string }).signedTransactionHex)
            : typeof result === "string"
              ? result
              : null;

        if (signed) {
          return broadcastViaExplorer(ensure0xHex(signed), chain === "X" ? "P" : chain);
        }
        errors.push(`${attempt.method}: missing signedTransactionHex`);
      } catch (error) {
        errors.push(`${attempt.method}: ${formatAttemptError(error)}`);
      }
    }
  }

  const detail = errors.filter(Boolean).slice(0, 4).join(" · ");
  throw new Error(
    detail
      ? `Core could not issue the ${chain}-chain transaction. ${detail}`
      : "Core refused to issue the transaction. Unlock Core and approve the popup in the extension toolbar.",
  );
}