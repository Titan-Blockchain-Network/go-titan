import { discoverTitanNodes } from "@/lib/titan/network-config";
import { enrichNodeFields, getRegistryNodes } from "@/lib/titan/node-registry";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

import { cChainRpc } from "./c-chain-rpc";

export interface NetworkMeshSnapshot {
  blockNumber: string;
  chainId: string | null;
  validatorsInMesh: number;
  meshPeerCount: number | null;
  rpcProbeNode: string | null;
  healthy: boolean;
  nodes: Array<{
    name: string;
    registryId?: string;
    blockNumber: string;
    healthy: boolean;
    role: string;
  }>;
}

export async function getNetworkMeshSnapshot(): Promise<NetworkMeshSnapshot> {
  const registry = getRegistryNodes();
  const discovered = await discoverTitanNodes();
  const bootstrap = discovered.find((n) => n.source === "seed") ?? discovered[0];

  let meshPeerCount: number | null = null;
  let healthy = false;
  let blockNumber = "0";
  let chainId: string | null = null;
  let rpcProbeNode: string | null = null;

  if (bootstrap) {
    const base = bootstrap.rpc;
    rpcProbeNode =
      enrichNodeFields({ nodeId: bootstrap.nodeId, fallback: bootstrap.node }).displayName ??
      bootstrap.node;

    try {
      const [healthRes, peersRes, blockHex, chainHex] = await Promise.all([
        titanNodeFetch(`${base}/ext/health`, { signal: AbortSignal.timeout(6000) })
          .then((r) => r.json())
          .catch(() => null),
        titanNodeFetch(`${base}/ext/info`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info.peers", params: {} }),
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => r.json())
          .catch(() => null),
        cChainRpc<string>("eth_blockNumber", []).catch(() => "0x0"),
        cChainRpc<string>("eth_chainId", []).catch(() => null),
      ]);

      healthy = healthRes?.healthy === true;
      const peers = peersRes?.result?.numPeers ?? peersRes?.result?.peers?.length;
      meshPeerCount = typeof peers === "number" ? peers : null;
      blockNumber = String(Number.parseInt(blockHex, 16));
      chainId = chainHex ? String(Number.parseInt(chainHex, 16)) : null;
    } catch {
      /* keep defaults */
    }
  }

  return {
    blockNumber,
    chainId,
    validatorsInMesh: registry.length || discovered.length,
    meshPeerCount,
    rpcProbeNode,
    healthy,
    nodes: registry.map((entry) => ({
      name: entry.name,
      registryId: entry.id,
      blockNumber,
      healthy,
      role: entry.role ?? "validator",
    })),
  };
}