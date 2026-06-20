export type TitanVmChain = "C" | "P" | "X";

export const TITAN_VM_CHAINS: TitanVmChain[] = ["C", "P", "X"];

export const TITAN_CHAIN_META: Record<
  TitanVmChain,
  { label: string; name: string; short: string; description: string }
> = {
  C: {
    label: "C",
    name: "C-Chain",
    short: "Contract Chain",
    description: "EVM execution — blocks, transactions, and smart contracts",
  },
  P: {
    label: "P",
    name: "P-Chain",
    short: "Platform Chain",
    description: "Validators, staking weight, and subnet coordination",
  },
  X: {
    label: "X",
    name: "X-Chain",
    short: "Exchange Chain",
    description: "AVM assets and cross-chain import/export",
  },
};

const STORAGE_KEY = "titan-explorer-chain";

export function readStoredTitanChain(): TitanVmChain {
  if (typeof window === "undefined") return "C";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "C" || raw === "P" || raw === "X") return raw;
  } catch {
    /* ignore */
  }
  return "C";
}

export function writeStoredTitanChain(chain: TitanVmChain): void {
  try {
    localStorage.setItem(STORAGE_KEY, chain);
  } catch {
    /* ignore */
  }
}