"use client";

import { useEffect, useState } from "react";

import { getTitanHomePath } from "@/lib/titan/nav";

export interface TitanClientConfig {
  networkName: string;
  networkId: number;
  chainIdDec: number;
  chainIdHex: string;
  rpcUrl: string;
  isLocalDev: boolean;
  logsEnabled: boolean;
  homePath: string;
}

const FALLBACK: TitanClientConfig = {
  networkName: "Titan",
  networkId: 888,
  chainIdDec: 888,
  chainIdHex: "0x378",
  rpcUrl: "https://rpc.titan-network.xyz/ext/bc/C/rpc",
  isLocalDev: false,
  logsEnabled: false,
  homePath: "/dashboard/activity",
};

export function useTitanConfig(): TitanClientConfig {
  const [config, setConfig] = useState<TitanClientConfig>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/titan/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        const isLocalDev = Boolean(j.isLocalDev);
        setConfig({
          networkName: j.networkName ?? FALLBACK.networkName,
          networkId: j.networkId ?? FALLBACK.networkId,
          chainIdDec: j.chainIdDec ?? FALLBACK.chainIdDec,
          chainIdHex: j.chainIdHex ?? FALLBACK.chainIdHex,
          rpcUrl: j.rpcUrl ?? FALLBACK.rpcUrl,
          isLocalDev,
          logsEnabled: Boolean(j.logsEnabled),
          homePath: getTitanHomePath({ isLocalDev }),
        });
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}