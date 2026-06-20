import { create } from "zustand";

import { APP_CONFIG } from "@/config/app-config";
import {
  connectWallet,
  getActiveEvmProvider,
  getActiveWalletKind,
  isCoreInstalled,
  peekCoreAddress,
  setActiveWalletKind,
  switchToTitanNetwork,
  type WalletKind,
  walletKindLabel,
} from "@/lib/titan/wallet-providers";
import { formatWeiToTitan } from "@/lib/titan/format";
import { titanRpc } from "@/lib/titan/rpc";

type WalletState = {
  address: string;
  chainId: string;
  walletKind: WalletKind | "";
  titanBalance: string;
  coreInstalled: boolean;
  coreAddress: string;
  signedIn: boolean;
  signMessage: string;
  isLoading: boolean;
  isRefreshingBalance: boolean;
  error: string;
  isHydrated: boolean;
  connect: (kind?: WalletKind) => Promise<void>;
  disconnect: () => void;
  signIn: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  refreshCoreStatus: () => Promise<void>;
  syncFromAccounts: (accounts: string[]) => Promise<void>;
  hydrate: () => Promise<void>;
};

async function fetchBalanceForAddress(walletAddress: string): Promise<string> {
  try {
    const balHex = (await titanRpc("eth_getBalance", [walletAddress, "latest"])) as string;
    return formatWeiToTitan(balHex);
  } catch {
    return "—";
  }
}

export const useWalletStore = create<WalletState>((set, get) => ({
  address: "",
  chainId: "",
  walletKind: "",
  titanBalance: "",
  coreInstalled: false,
  coreAddress: "",
  signedIn: false,
  signMessage: "",
  isLoading: false,
  isRefreshingBalance: false,
  error: "",
  isHydrated: false,

  refreshCoreStatus: async () => {
    const coreInstalled = isCoreInstalled();
    const coreAddress = coreInstalled ? await peekCoreAddress() : "";
    set({ coreInstalled, coreAddress });
  },

  refreshBalance: async () => {
    const { address } = get();
    if (!address) return;

    set({ isRefreshingBalance: true });
    const balance = await fetchBalanceForAddress(address);
    set({ titanBalance: balance, isRefreshingBalance: false });
  },

  syncFromAccounts: async (accounts: string[]) => {
    const selectedAddress = accounts?.[0] ?? "";
    if (!selectedAddress) {
      set({
        address: "",
        chainId: "",
        walletKind: "",
        titanBalance: "",
        signedIn: false,
        signMessage: "",
      });
      setActiveWalletKind("");
      return;
    }

    const provider = getActiveEvmProvider();
    let selectedChain = get().chainId;
    if (provider) {
      selectedChain = (await provider.request({ method: "eth_chainId" })) as string;
    }

    const balance = await fetchBalanceForAddress(selectedAddress);
    set({
      address: selectedAddress,
      chainId: selectedChain,
      walletKind: getActiveWalletKind(),
      titanBalance: balance,
    });
    await get().refreshCoreStatus();
  },

  hydrate: async () => {
    await get().refreshCoreStatus();
    const provider = getActiveEvmProvider();
    if (!provider) {
      set({ isHydrated: true, walletKind: getActiveWalletKind() });
      return;
    }

    try {
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      if (accounts?.[0]) {
        await get().syncFromAccounts(accounts);
      } else {
        set({ walletKind: getActiveWalletKind() });
      }
    } catch {
      // Wallet not available or permission not granted yet.
    } finally {
      set({ isHydrated: true });
    }
  },

  connect: async (kind = "metamask") => {
    set({ error: "", isLoading: true });
    try {
      const result = await connectWallet(kind);
      const balance = await fetchBalanceForAddress(result.address);
      set({
        address: result.address,
        chainId: result.chainId,
        walletKind: result.kind,
        titanBalance: balance,
      });
      await get().refreshCoreStatus();
    } catch (connectError) {
      set({
        error:
          connectError instanceof Error
            ? connectError.message
            : `${walletKindLabel(kind)} connection failed.`,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  disconnect: () => {
    setActiveWalletKind("");
    set({
      address: "",
      chainId: "",
      walletKind: "",
      titanBalance: "",
      signedIn: false,
      signMessage: "",
      error: "",
    });
  },

  signIn: async () => {
    set({ error: "" });
    const provider = getActiveEvmProvider();
    const kind = getActiveWalletKind() || "metamask";
    if (!provider) {
      set({ error: `${walletKindLabel(kind)} not found. Connect your wallet first.` });
      return;
    }

    set({ isLoading: true });
    try {
      await switchToTitanNetwork(provider);
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const selectedAddress = accounts?.[0];

      if (!selectedAddress) {
        throw new Error(`No account returned by ${walletKindLabel(kind)}.`);
      }

      const message = `Titan Explorer sign-in\nAddress: ${selectedAddress}\nTimestamp: ${new Date().toISOString()}\nOrigin: ${window.location.origin}`;
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, selectedAddress],
      })) as string;

      const selectedChain = (await provider.request({ method: "eth_chainId" })) as string;
      const balance = await fetchBalanceForAddress(selectedAddress);
      set({
        address: selectedAddress,
        chainId: selectedChain,
        walletKind: kind,
        titanBalance: balance,
        signedIn: true,
        signMessage: `Signed in with wallet. Signature: ${signature.slice(0, 14)}...${signature.slice(-10)}`,
      });
      await get().refreshCoreStatus();
    } catch (signInError) {
      set({ error: signInError instanceof Error ? signInError.message : "Wallet sign-in failed." });
    } finally {
      set({ isLoading: false });
    }
  },
}));

export function isWalletConnected(state: Pick<WalletState, "address">): boolean {
  return Boolean(state.address);
}

export function isOnTitanChain(chainId: string): boolean {
  return chainId.toLowerCase() === APP_CONFIG.titan.chainIdHex.toLowerCase();
}