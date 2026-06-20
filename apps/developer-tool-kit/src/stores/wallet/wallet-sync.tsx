"use client";

import { useEffect } from "react";

import { getActiveEvmProvider, listenForCoreProvider } from "@/lib/titan/wallet-providers";

import { useWalletStore } from "./wallet-store";

export function WalletSync() {
  const hydrate = useWalletStore((s) => s.hydrate);
  const syncFromAccounts = useWalletStore((s) => s.syncFromAccounts);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);
  const refreshCoreStatus = useWalletStore((s) => s.refreshCoreStatus);
  const address = useWalletStore((s) => s.address);
  const walletKind = useWalletStore((s) => s.walletKind);

  useEffect(() => {
    void hydrate();
    const stop = listenForCoreProvider();
    const timer = window.setInterval(() => void refreshCoreStatus(), 3000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [hydrate, refreshCoreStatus]);

  useEffect(() => {
    const provider = getActiveEvmProvider();
    if (!provider?.on) return;

    const handleAccountsChanged = (accounts: unknown) => {
      void syncFromAccounts(accounts as string[]);
    };

    const handleChainChanged = (nextChainId: unknown) => {
      useWalletStore.setState({ chainId: String(nextChainId) });
      if (address) {
        void refreshBalance();
      }
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [address, refreshBalance, syncFromAccounts, walletKind]);

  return null;
}