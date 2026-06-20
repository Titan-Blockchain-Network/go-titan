import { create } from "zustand";

import { APP_CONFIG } from "@/config/app-config";
import {
  readNetworkStatusCache,
  writeNetworkStatusCache,
  type CachedNetworkRuntime,
  type CachedNodeHealth,
} from "@/lib/titan/network-status-cache";

export type NetworkNodeHealth = CachedNodeHealth;
export type NetworkRuntimeConfig = CachedNetworkRuntime;

type NetworkStatusState = {
  nodes: NetworkNodeHealth[];
  meshPeerCount: number | null;
  rpcProbeNode: string | null;
  runtime: NetworkRuntimeConfig | null;
  lastUpdated: number | null;
  hydrated: boolean;
  loading: boolean;
  isRefreshing: boolean;
  hydrate: () => void;
  refresh: () => Promise<void>;
};

function applyCache(set: (partial: Partial<NetworkStatusState>) => void) {
  const cached = readNetworkStatusCache();
  if (!cached) return false;

  set({
    nodes: cached.nodes,
    meshPeerCount: cached.meshPeerCount,
    rpcProbeNode: cached.rpcProbeNode,
    runtime: cached.runtime,
    lastUpdated: cached.fetchedAt,
  });
  return cached.nodes.length > 0;
}

export const useNetworkStatusStore = create<NetworkStatusState>((set, get) => ({
  nodes: [],
  meshPeerCount: null,
  rpcProbeNode: null,
  runtime: null,
  lastUpdated: null,
  hydrated: false,
  loading: false,
  isRefreshing: false,

  hydrate: () => {
    const hasCached = applyCache(set);
    set({ hydrated: true, loading: !hasCached });
  },

  refresh: async () => {
    const { nodes, hydrated } = get();
    const hasData = nodes.length > 0;

    if (!hasData) {
      set({ loading: true });
    } else {
      set({ isRefreshing: true });
    }

    try {
      const [rpcRes, configRes] = await Promise.all([
        fetch("/api/titan/rpc"),
        fetch("/api/titan/config"),
      ]);

      const rpcData = await rpcRes.json();
      const fetchedAt = Date.now();

      let runtime: NetworkRuntimeConfig | null = get().runtime;
      if (configRes.ok) {
        const cfg = await configRes.json();
        runtime = {
          rpcUrl: cfg.rpcUrl ?? APP_CONFIG.titan.rpcUrl,
          dashboardUrl: cfg.dashboardUrl ?? APP_CONFIG.titan.dashboardUrl,
          explorerUrl: cfg.explorerUrl ?? APP_CONFIG.titan.explorerUrl,
          networkName: cfg.networkName ?? APP_CONFIG.titan.networkName,
          networkId: cfg.networkId ?? APP_CONFIG.titan.networkId,
        };
      }

      const nextNodes = (rpcData.nodes ?? []) as NetworkNodeHealth[];
      const meshPeerCount =
        typeof rpcData.meshPeerCount === "number" ? rpcData.meshPeerCount : null;
      const rpcProbeNode =
        typeof rpcData.rpcProbeNode === "string" ? rpcData.rpcProbeNode : null;

      set({
        nodes: nextNodes,
        meshPeerCount,
        rpcProbeNode,
        runtime,
        lastUpdated: fetchedAt,
        loading: false,
        isRefreshing: false,
      });

      writeNetworkStatusCache({
        nodes: nextNodes,
        meshPeerCount,
        rpcProbeNode,
        runtime,
        fetchedAt,
      });
    } catch {
      if (!hasData && hydrated) {
        set({ nodes: [], loading: false, isRefreshing: false });
      } else {
        set({ loading: false, isRefreshing: false });
      }
    }
  },
}));