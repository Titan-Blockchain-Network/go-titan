import { create } from "zustand";

import {
  readStoredTitanChain,
  type TitanVmChain,
  writeStoredTitanChain,
} from "@/lib/titan/chains";

type TitanChainState = {
  chain: TitanVmChain;
  hydrated: boolean;
  setChain: (chain: TitanVmChain) => void;
  hydrate: () => void;
};

export const useTitanChainStore = create<TitanChainState>((set) => ({
  chain: "C",
  hydrated: false,
  setChain: (chain) => {
    writeStoredTitanChain(chain);
    set({ chain });
  },
  hydrate: () => {
    set({ chain: readStoredTitanChain(), hydrated: true });
  },
}));