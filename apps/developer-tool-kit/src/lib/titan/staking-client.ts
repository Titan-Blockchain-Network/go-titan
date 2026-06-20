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

function extractSignedHex(result: unknown): string | null {
  if (typeof result === "string" && result.length > 2) {
    return ensure0xHex(result);
  }
  if (!result || typeof result !== "object") return null;

  const record = result as Record<string, unknown>;
  for (const key of ["signedTransactionHex", "signedTx", "tx", "transactionHex"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 2) {
      return ensure0xHex(value);
    }
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
    throw new Error(json.error ?? "Titan node refused to broadcast the signed transaction.");
  }
  if (!json.txID) {
    throw new Error("Titan node accepted the broadcast but returned no transaction ID.");
  }
  return json.txID;
}

async function signWithCore(
  wallet: EthereumProvider,
  transactionHex: string,
  chain: "C" | "P" | "X",
): Promise<{ signedHex: string | null; errors: string[] }> {
  const errors: string[] = [];
  const base = { transactionHex, chainAlias: chain };

  const attempts: Array<{ method: string; params: unknown }> = [
    { method: "avalanche_signTransaction", params: base },
    { method: "avalanche_signTransaction", params: [transactionHex, chain] },
    { method: "avalanche_signTransaction", params: [{ ...base, externalIndices: [0] }] },
    {
      method: "avalanche_signTransaction",
      params: [{ ...base, externalIndices: [0], internalIndices: [] }],
    },
    { method: "avalanche_signTransaction", params: [{ transactionHex, chainAlias: chain }] },
  ];

  for (const attempt of attempts) {
    try {
      const result = await wallet.request(attempt);
      const signedHex = extractSignedHex(result);
      if (signedHex) {
        return { signedHex, errors };
      }
      errors.push(`${attempt.method}: missing signedTransactionHex`);
    } catch (error) {
      errors.push(`${attempt.method}: ${formatAttemptError(error)}`);
    }
  }

  return { signedHex: null, errors };
}

/**
 * Sign in Core, broadcast via Titan RPC.
 * Core cannot broadcast atomic txs to custom L1 network 888 (eip155:888) — only mainnet/Fuji.
 */
export async function issueAtomicTx(txHex: string, chain: "C" | "P" | "X"): Promise<string> {
  const wallet = getAvalancheWallet();
  if (!wallet) {
    throw new Error(
      "Avalanche Core wallet not detected. Install Core (core.app) or use the CLI with your operator key.",
    );
  }

  const transactionHex = ensure0xHex(txHex);
  const broadcastChain: "C" | "P" = chain === "X" ? "P" : chain;

  const { signedHex, errors: signErrors } = await signWithCore(wallet, transactionHex, chain);
  if (signedHex) {
    return broadcastViaExplorer(signedHex, broadcastChain);
  }

  const detail = signErrors.filter(Boolean).slice(0, 3).join(" · ");
  throw new Error(
    detail
      ? `Core could not sign the ${chain}-chain transaction for Titan (network 888). ${detail} — Core may show "0 AVAX" in the prompt; the real amount is TITAN. If signing is unsupported for custom L1s, use the Avalanche CLI against rpc.titan-network.xyz.`
      : `Core could not sign the ${chain}-chain transaction. Unlock Core and approve the popup in the extension toolbar.`,
  );
}