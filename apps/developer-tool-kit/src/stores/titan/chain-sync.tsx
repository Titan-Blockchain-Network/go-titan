"use client";

import { useEffect } from "react";

import { useTitanChainStore } from "@/stores/titan/chain-store";

/** Hydrates persisted C/P/X chain selection on the client. */
export function TitanChainSync() {
  const hydrate = useTitanChainStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return null;
}