type AvalancheProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

export function getAvalancheWallet(): AvalancheProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    avalanche?: AvalancheProvider & { isAvalanche?: boolean };
    core?: AvalancheProvider;
  };
  if (w.avalanche?.request) return w.avalanche;
  if (w.core?.request) return w.core;

  // EIP-6963 multi-wallet discovery (Core, etc.)
  const discovered = (w as Window & { __titanAvalancheProvider?: AvalancheProvider })
    .__titanAvalancheProvider;
  return discovered?.request ? discovered : undefined;
}

/** Register Core / Avalanche wallet from EIP-6963 announcements. */
export function listenForAvalancheWallet(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { name?: string }; provider?: AvalancheProvider }>)
      .detail;
    const name = detail?.info?.name?.toLowerCase() ?? "";
    if (
      detail?.provider?.request &&
      (name.includes("core") || name.includes("avalanche"))
    ) {
      (window as Window & { __titanAvalancheProvider?: AvalancheProvider }).__titanAvalancheProvider =
        detail.provider;
    }
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
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
    { method: "wallet_issueTx", params: { tx: txHex, chainAlias: chain } },
    { method: "wallet_issueTx", params: [{ tx: txHex, chainAlias: chain }] },
    { method: "wallet_issueTx", params: [{ txHex, chainAlias: chain }] },
    { method: "avax_issueTx", params: { tx: txHex, chainAlias: chain } },
    { method: "avax.issueTx", params: { tx: txHex, chainAlias: chain } },
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