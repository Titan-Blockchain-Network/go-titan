import { APP_CONFIG } from "@/config/app-config";

export type TitanRuntimeConfig = {
  networkName: string;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  dashboardUrl: string;
  defaultNode?: string;
};

let cached: TitanRuntimeConfig | null = null;
let inflight: Promise<TitanRuntimeConfig> | null = null;

/** Client-side network config from /api/titan/config (Vercel env / bootstrap discovery). */
export async function getTitanRuntimeConfig(): Promise<TitanRuntimeConfig> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = fetch("/api/titan/config")
    .then(async (res) => {
      if (!res.ok) throw new Error(`config HTTP ${res.status}`);
      const j = (await res.json()) as {
        networkName?: string;
        chainIdHex?: string;
        rpcUrl?: string;
        explorerUrl?: string;
        dashboardUrl?: string;
        nodes?: Array<{ node?: string }>;
      };
      const config: TitanRuntimeConfig = {
        networkName: j.networkName ?? APP_CONFIG.titan.networkName,
        chainIdHex: j.chainIdHex ?? APP_CONFIG.titan.chainIdHex,
        rpcUrl: j.rpcUrl ?? APP_CONFIG.titan.rpcUrl,
        explorerUrl: j.explorerUrl ?? APP_CONFIG.titan.explorerUrl,
        dashboardUrl: j.dashboardUrl ?? APP_CONFIG.titan.dashboardUrl,
        defaultNode: j.nodes?.[0]?.node,
      };
      cached = config;
      return config;
    })
    .catch(() => {
      const fallback: TitanRuntimeConfig = {
        networkName: APP_CONFIG.titan.networkName,
        chainIdHex: APP_CONFIG.titan.chainIdHex,
        rpcUrl: APP_CONFIG.titan.rpcUrl,
        explorerUrl: APP_CONFIG.titan.explorerUrl,
        dashboardUrl: APP_CONFIG.titan.dashboardUrl,
        defaultNode: "node1",
      };
      cached = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearTitanRuntimeConfigCache() {
  cached = null;
  inflight = null;
}