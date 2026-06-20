export type { EthereumProvider, WalletKind } from "@/lib/titan/wallet-providers";
export {
  connectWallet,
  getActiveEvmProvider,
  getActiveWalletKind,
  getCoreProvider,
  getMetaMaskProvider,
  getProviderForKind,
  isCoreInstalled,
  peekCoreAddress,
  setActiveWalletKind,
  switchToTitanNetwork,
  walletKindLabel,
} from "@/lib/titan/wallet-providers";

import { connectWallet, getActiveEvmProvider } from "@/lib/titan/wallet-providers";

/** Connected wallet provider (MetaMask or Core), falling back to MetaMask. */
export function getEthereumProvider() {
  return getActiveEvmProvider();
}

/** @deprecated Use connectWallet("metamask") */
export async function connectMetaMask() {
  const { address, chainId } = await connectWallet("metamask");
  return { address, chainId };
}