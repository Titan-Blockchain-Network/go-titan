import { APP_CONFIG } from "@/config/app-config";
import { getTitanRuntimeConfig } from "@/lib/titan/network-runtime";
import { parseWalletError } from "@/lib/titan/wallet-errors";

export type WalletKind = "metamask" | "core";

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const STORAGE_KEY = "titan-explorer-wallet-kind";

let activeKind: WalletKind | "" = "";

export function setActiveWalletKind(kind: WalletKind | ""): void {
  activeKind = kind;
  if (typeof sessionStorage === "undefined") return;
  if (kind) sessionStorage.setItem(STORAGE_KEY, kind);
  else sessionStorage.removeItem(STORAGE_KEY);
}

export function getActiveWalletKind(): WalletKind | "" {
  if (activeKind) return activeKind;
  if (typeof sessionStorage === "undefined") return "";
  const stored = sessionStorage.getItem(STORAGE_KEY);
  return stored === "metamask" || stored === "core" ? stored : "";
}

export function getMetaMaskProvider(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

export function getCoreProvider(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    avalanche?: EthereumProvider;
    core?: EthereumProvider;
    __titanAvalancheProvider?: EthereumProvider;
  };
  if (w.avalanche?.request) return w.avalanche;
  if (w.core?.request) return w.core;
  if (w.__titanAvalancheProvider?.request) return w.__titanAvalancheProvider;
  return undefined;
}

export function isCoreInstalled(): boolean {
  return Boolean(getCoreProvider());
}

export function getProviderForKind(kind: WalletKind): EthereumProvider | undefined {
  return kind === "core" ? getCoreProvider() : getMetaMaskProvider();
}

/** Active EVM provider (MetaMask or Core) chosen at connect time. */
export function getActiveEvmProvider(): EthereumProvider | undefined {
  const kind = getActiveWalletKind();
  if (kind) {
    return getProviderForKind(kind);
  }
  return getMetaMaskProvider() ?? getCoreProvider();
}

export function walletKindLabel(kind: WalletKind | ""): string {
  if (kind === "core") return "Avalanche Core";
  if (kind === "metamask") return "MetaMask";
  return "Wallet";
}

async function titanChainParams() {
  const runtime = await getTitanRuntimeConfig();
  return {
    chainIdHex: runtime.chainIdHex,
    params: {
      chainId: runtime.chainIdHex,
      chainName: runtime.networkName,
      nativeCurrency: {
        name: APP_CONFIG.titan.nativeToken.name,
        symbol: APP_CONFIG.titan.nativeToken.symbol,
        decimals: APP_CONFIG.titan.nativeToken.decimals,
      },
      rpcUrls: [runtime.rpcUrl],
      blockExplorerUrls: runtime.explorerUrl ? [runtime.explorerUrl] : [],
    },
  };
}

/** Prompt Core / MetaMask to add Titan (chain 888) as a custom EVM network. */
export async function addTitanNetwork(provider: EthereumProvider): Promise<void> {
  const { params } = await titanChainParams();
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [params],
  });
}

export async function switchToTitanNetwork(
  provider: EthereumProvider,
  options?: { kind?: WalletKind; softFail?: boolean },
): Promise<string | undefined> {
  const { chainIdHex, params } = await titanChainParams();

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return undefined;
  } catch (switchError) {
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [params],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      return undefined;
    } catch (addError) {
      const message = parseWalletError(
        addError,
        parseWalletError(switchError, "Could not switch to Titan network (888)."),
      );

      if (options?.softFail || options?.kind === "core") {
        return message;
      }
      throw new Error(message);
    }
  }
}

export function isOnTitanChainId(chainId: string): boolean {
  return chainId.toLowerCase() === APP_CONFIG.titan.chainIdHex.toLowerCase();
}

/** Staking reads balances via explorer RPC; Core only needs an address + extension for atomic txs. */
export function isStakingNetworkReady(chainId: string, kind: WalletKind | ""): boolean {
  if (isOnTitanChainId(chainId)) return true;
  return kind === "core" && Boolean(chainId);
}

export async function connectWallet(kind: WalletKind): Promise<{
  address: string;
  chainId: string;
  kind: WalletKind;
  networkWarning?: string;
}> {
  const provider = getProviderForKind(kind);
  if (!provider) {
    throw new Error(
      kind === "core"
        ? "Avalanche Core not found. Install Core (core.app), unlock it, and refresh."
        : "MetaMask not found. Install MetaMask and refresh the page.",
    );
  }

  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch (error) {
    throw new Error(
      parseWalletError(
        error,
        kind === "core"
          ? "Core connection rejected. Unlock Core, click Connect Core again, and approve site access."
          : "MetaMask connection rejected.",
      ),
    );
  }

  const address = accounts?.[0];
  if (!address) {
    throw new Error(`No account returned by ${walletKindLabel(kind)}. Unlock the wallet and try again.`);
  }

  const networkWarning = await switchToTitanNetwork(provider, { kind, softFail: kind === "core" });
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  setActiveWalletKind(kind);

  let warning = networkWarning;
  if (kind === "core" && !isOnTitanChainId(chainId)) {
    warning =
      warning ??
      `Core is connected as ${address.slice(0, 6)}… but not on Titan (888) yet. Click "Add Titan to Core" — Core has no manual network UI; the explorer will prompt Core to add chain 888.`;
  }

  return { address, chainId, kind, networkWarning: warning };
}

/** Read Core's current account without prompting (if already authorized). */
export async function peekCoreAddress(): Promise<string> {
  const provider = getCoreProvider();
  if (!provider) return "";
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? "";
  } catch {
    return "";
  }
}

/** Register Core from EIP-6963 wallet discovery. */
export function listenForCoreProvider(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { name?: string }; provider?: EthereumProvider }>)
      .detail;
    const name = detail?.info?.name?.toLowerCase() ?? "";
    if (
      detail?.provider?.request &&
      (name.includes("core") || name.includes("avalanche"))
    ) {
      (window as Window & { __titanAvalancheProvider?: EthereumProvider }).__titanAvalancheProvider =
        detail.provider;
    }
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}