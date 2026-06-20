type AvalancheProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

export function getAvalancheWallet(): AvalancheProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    avalanche?: AvalancheProvider;
    core?: AvalancheProvider;
  };
  return w.avalanche ?? w.core;
}

export function hasAvalancheWallet(): boolean {
  return Boolean(getAvalancheWallet());
}

/** Issue a signed or wallet-signable atomic tx via Avalanche Core (or compatible extension). */
export async function issueAtomicTx(txHex: string, chain: "C" | "P" | "X"): Promise<string> {
  const wallet = getAvalancheWallet();
  if (!wallet) {
    throw new Error(
      "Avalanche Core wallet not detected. Install Core (core.app) or use the CLI with your operator key.",
    );
  }

  const attempts: Array<{ method: string; params: unknown }> = [
    { method: "wallet_issueTx", params: [{ tx: txHex, chainAlias: chain }] },
    { method: "wallet_issueTx", params: [{ txHex, chainAlias: chain }] },
    { method: "avax_issueTx", params: { tx: txHex, chainAlias: chain } },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const result = await wallet.request(attempt);
      if (typeof result === "string" && result.length > 0) return result;
      if (result && typeof result === "object" && "txID" in result) {
        return String((result as { txID: string }).txID);
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Wallet refused to issue the transaction.");
}