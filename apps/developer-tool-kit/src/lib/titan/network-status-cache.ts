"use client";

import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

export const NETWORK_STATUS_CACHE_KEY = "titan-explorer-network-status-v1";

export interface CachedNodeHealth {
  node: string;
  nodeId?: string;
  displayName?: string;
  registryDroplet?: string;
  host?: string;
  port: number;
  displayUrl?: string;
  healthy: boolean;
  peers?: number;
  chainId?: string;
  blockNumber?: string;
  error?: string;
  discoveryMethod?: "bootstrap" | "p2p-gossip" | "direct-probe";
  inMesh?: boolean;
}

export interface CachedNetworkRuntime {
  rpcUrl: string;
  dashboardUrl: string;
  explorerUrl: string;
  networkName: string;
  networkId?: number;
}

export interface NetworkStatusCache {
  v: 1;
  nodes: CachedNodeHealth[];
  meshPeerCount: number | null;
  rpcProbeNode: string | null;
  runtime: CachedNetworkRuntime | null;
  fetchedAt: number;
}

export function readNetworkStatusCache(): NetworkStatusCache | null {
  const raw = getLocalStorageValue(NETWORK_STATUS_CACHE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as NetworkStatusCache;
    if (parsed.v !== 1 || !Array.isArray(parsed.nodes) || typeof parsed.fetchedAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeNetworkStatusCache(snapshot: Omit<NetworkStatusCache, "v">) {
  const payload: NetworkStatusCache = { v: 1, ...snapshot };
  setLocalStorageValue(NETWORK_STATUS_CACHE_KEY, JSON.stringify(payload));
}