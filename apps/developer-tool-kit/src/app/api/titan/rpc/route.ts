import { NextRequest, NextResponse } from "next/server";

import { discoverTitanNodes } from "@/lib/titan/network-config";
import { enrichNodeFields, resolveRegistryNode } from "@/lib/titan/node-registry";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

interface PeerEntry {
  ip?: string;
  publicIP?: string;
  nodeID?: string;
  version?: string;
  lastSent?: string;
  lastReceived?: string;
  benched?: string[];
  observedUptime?: number | string;
}

export interface TitanNodeStatus {
  node: string;
  nodeId?: string;
  host?: string;
  port: number;
  displayUrl?: string;
  source?: "seed" | "local" | "peer";
  healthy: boolean;
  peers?: number;
  chainId?: string;
  blockNumber?: string;
  gasPrice?: string;
  version?: string;
  publicIp?: string;
  observedUptime?: number;
  lastSent?: string;
  lastReceived?: string;
  benched?: string[];
  error?: string;
  /** Pantheon name from titan-node-registry.json (Atlas, Prometheus, …). */
  displayName?: string;
  registryId?: string;
  registryRole?: string;
  registryDroplet?: string;
  registryIp?: string;
  /** How this row was populated for the explorer UI. */
  discoveryMethod?: "bootstrap" | "p2p-gossip" | "direct-probe";
  /** Seen in info.peers on the bootstrap node (full mesh member). */
  inMesh?: boolean;
}

function withRegistry(node: TitanNodeStatus): TitanNodeStatus {
  const registry = enrichNodeFields({
    nodeId: node.nodeId,
    host: node.host,
    publicIp: node.publicIp,
    displayUrl: node.displayUrl,
    fallback: node.node,
  });
  return { ...node, ...registry };
}

function shortNodeLabel(nodeId: string): string {
  return nodeId.replace(/^NodeID-/, "").slice(0, 12);
}

function parseObservedUptime(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : undefined;
}

function peerToNodeStatus(peer: PeerEntry): TitanNodeStatus | null {
  const nodeId = peer.nodeID?.trim();
  if (!nodeId) return null;

  const endpoint = peer.publicIP?.trim() || peer.ip?.trim() || "unknown";
  const colon = endpoint.lastIndexOf(":");
  const host = colon > 0 ? endpoint.slice(0, colon) : endpoint;
  const port =
    colon > 0 ? Number.parseInt(endpoint.slice(colon + 1), 10) || 9651 : 9651;

  return {
    node: shortNodeLabel(nodeId),
    nodeId,
    host,
    port,
    displayUrl: endpoint,
    source: "peer",
    healthy: true,
    inMesh: true,
    discoveryMethod: "p2p-gossip",
    version: peer.version,
    publicIp: peer.publicIP || peer.ip,
    observedUptime: parseObservedUptime(peer.observedUptime),
    lastSent: peer.lastSent,
    lastReceived: peer.lastReceived,
    benched: peer.benched,
  };
}

async function jsonRpc(url: string, method: string, params: unknown[] = [], timeoutMs = 3000) {
  const res = await titanNodeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

export async function GET() {
  const targets = await discoverTitanNodes();

  const results = await Promise.allSettled(
    targets.map(async ({ node, rpc, port, host, nodeId, displayUrl, source }) => {
      const cRpc = `${rpc}/ext/bc/C/rpc`;
      const infoRpc = `${rpc}/ext/info`;
      const healthRpc = `${rpc}/ext/health`;

      const [healthRes, peersRes, chainIdRes, blockRes, gasPriceRes] =
        await Promise.allSettled([
          titanNodeFetch(healthRpc, { signal: AbortSignal.timeout(3000) }).then((r) =>
            r.json(),
          ),
          jsonRpc(infoRpc, "info.peers"),
          jsonRpc(cRpc, "eth_chainId"),
          jsonRpc(cRpc, "eth_blockNumber"),
          jsonRpc(cRpc, "eth_gasPrice"),
        ]);

      const healthy =
        healthRes.status === "fulfilled" &&
        healthRes.value?.healthy === true;
      const peerList: PeerEntry[] =
        peersRes.status === "fulfilled"
          ? ((peersRes.value?.result?.peers ?? []) as PeerEntry[])
          : [];
      const peers =
        peersRes.status === "fulfilled"
          ? (normalizePeerCount(peersRes.value?.result?.numPeers ?? peerList.length) ?? 0)
          : 0;
      const chainIdHex =
        chainIdRes.status === "fulfilled"
          ? chainIdRes.value?.result
          : undefined;
      const chainId = chainIdHex
        ? String(parseInt(chainIdHex, 16))
        : undefined;
      const blockHex =
        blockRes.status === "fulfilled" ? blockRes.value?.result : undefined;
      const blockNumber = blockHex
        ? String(parseInt(blockHex, 16))
        : undefined;
      const gasPriceHex =
        gasPriceRes.status === "fulfilled"
          ? gasPriceRes.value?.result
          : undefined;
      const gasPrice = gasPriceHex
        ? `${(BigInt(gasPriceHex) / BigInt(1e9)).toString()} gwei`
        : undefined;

      return {
        node,
        nodeId,
        host,
        port,
        displayUrl,
        source,
        healthy,
        peers,
        chainId,
        blockNumber,
        gasPrice,
        peerList,
      };
    }),
  );

  const configured: TitanNodeStatus[] = results.map((r, i) => {
    if (r.status === "fulfilled") {
      const { peerList: _peerList, ...rest } = r.value;
      return rest;
    }
    return {
      node: targets[i].node,
      nodeId: targets[i].nodeId,
      host: targets[i].host,
      port: targets[i].port,
      displayUrl: targets[i].displayUrl,
      source: targets[i].source,
      healthy: false,
      peers: 0,
      error: String((r as PromiseRejectedResult).reason),
    };
  });

  const knownNodeIds = new Set(
    configured.map((n) => n.nodeId).filter((id): id is string => Boolean(id)),
  );
  const seenPeerIds = new Set<string>();
  const discoveredPeers: TitanNodeStatus[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const peer of result.value.peerList) {
      const nodeId = peer.nodeID?.trim();
      if (!nodeId || knownNodeIds.has(nodeId) || seenPeerIds.has(nodeId)) continue;
      seenPeerIds.add(nodeId);
      const card = peerToNodeStatus(peer);
      if (card) discoveredPeers.push(card);
    }
  }

  const anchor = configured.find((n) => n.source === "seed") ?? configured[0];
  if (anchor) {
    anchor.discoveryMethod = "bootstrap";
  }

  const enrichedPeers = await enrichDiscoveredPeers(discoveredPeers, anchor);
  const allNodes = [...configured, ...enrichedPeers].map(withRegistry);
  const bootstrapNode = allNodes.find((n) => n.discoveryMethod === "bootstrap");
  const meshCount = normalizePeerCount(bootstrapNode?.peers) ?? 4;

  return NextResponse.json({
    meshPeerCount: meshCount,
    networkHeadBlock: bootstrapNode?.blockNumber ?? null,
    rpcProbeNode: bootstrapNode?.displayName ?? bootstrapNode?.node ?? null,
    nodes: allNodes,
  });
}

function normalizePeerCount(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function probeRegistryNode(ip: string): Promise<Partial<TitanNodeStatus> | null> {
  const base = `http://${ip}:9650`;
  const timeoutMs = 2500;
  try {
    const [healthRes, peersRes, blockRes, chainRes] = await Promise.allSettled([
      titanNodeFetch(`${base}/ext/health`, { signal: AbortSignal.timeout(timeoutMs) }).then((r) =>
        r.json(),
      ),
      jsonRpc(`${base}/ext/info`, "info.peers", [], timeoutMs),
      jsonRpc(`${base}/ext/bc/C/rpc`, "eth_blockNumber", [], timeoutMs),
      jsonRpc(`${base}/ext/bc/C/rpc`, "eth_chainId", [], timeoutMs),
    ]);

    const healthy =
      healthRes.status === "fulfilled" && healthRes.value?.healthy === true;
    const peerList: PeerEntry[] =
      peersRes.status === "fulfilled"
        ? ((peersRes.value?.result?.peers ?? []) as PeerEntry[])
        : [];
    const peersRaw =
      peersRes.status === "fulfilled"
        ? (peersRes.value?.result?.numPeers ?? peerList.length)
        : undefined;
    const peers = normalizePeerCount(peersRaw) ?? undefined;
    const blockHex =
      blockRes.status === "fulfilled" ? blockRes.value?.result : undefined;
    const blockNumber = blockHex ? String(Number.parseInt(blockHex, 16)) : undefined;
    const chainIdHex =
      chainRes.status === "fulfilled" ? chainRes.value?.result : undefined;
    const chainId = chainIdHex ? String(Number.parseInt(chainIdHex, 16)) : undefined;

    if (blockNumber == null && !healthy) return null;

    return {
      healthy,
      peers,
      blockNumber,
      chainId,
      discoveryMethod: "direct-probe",
      inMesh: true,
    };
  } catch {
    return null;
  }
}

/** P2P rows from info.peers: try direct HTTP, else inherit network head from bootstrap. */
async function enrichDiscoveredPeers(
  peers: TitanNodeStatus[],
  anchor?: TitanNodeStatus,
): Promise<TitanNodeStatus[]> {
  return Promise.all(
    peers.map(async (peer) => {
      const reg = resolveRegistryNode({
        nodeId: peer.nodeId,
        host: peer.host,
        publicIp: peer.publicIp,
        displayUrl: peer.displayUrl,
      });
      const ip = reg?.ip ?? peer.host;
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        const probed = await probeRegistryNode(ip);
        if (probed) {
          return { ...peer, ...probed };
        }
      }

      return {
        ...peer,
        blockNumber: anchor?.blockNumber,
        chainId: anchor?.chainId,
        gasPrice: anchor?.gasPrice,
        discoveryMethod: "p2p-gossip",
        inMesh: true,
      };
    }),
  );
}

// POST: Proxy generic JSON-RPC calls for the explorer (and other clients).
// Body: { method: string, params?: unknown[], node?: string, chain?: "C"|"info" }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      method?: string;
      params?: unknown[];
      node?: string;
      chain?: string;
    };

    const method = body.method;
    if (!method || typeof method !== "string") {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32600, message: "method is required" } },
        { status: 400 },
      );
    }

    const params = Array.isArray(body.params) ? body.params : [];
    const chain = (body.chain ?? "C").toUpperCase();

    const nodes = await discoverTitanNodes();
    const nodeName = body.node;
    const target =
      (nodeName
        ? nodes.find((n) => {
            const needle = nodeName.toLowerCase();
            const registry = enrichNodeFields({
              nodeId: n.nodeId,
              host: n.host,
              displayUrl: n.displayUrl,
              fallback: n.node,
            });
            return (
              n.node === nodeName ||
              n.nodeId === nodeName ||
              n.nodeId?.includes(nodeName) ||
              registry.displayName.toLowerCase() === needle ||
              registry.registryId?.toLowerCase() === needle
            );
          })
        : null) ?? nodes[0];

    if (!target) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32603, message: "no Titan nodes configured" } },
        { status: 503 },
      );
    }

    const base = target.rpc;

    let path = "/ext/bc/C/rpc";
    if (chain === "INFO") path = "/ext/info";
    else if (chain === "HEALTH") path = "/ext/health";
    else if (chain === "P") path = "/ext/bc/P";
    else if (chain === "X") path = "/ext/bc/X";

    const url = `${base}${path}`;

    const resp = await titanNodeFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: AbortSignal.timeout(15000),
    });

    const j = await resp.json();
    return NextResponse.json(j);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message } },
      { status: 500 },
    );
  }
}