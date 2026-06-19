import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

export type TitanNodeScheme = "http" | "https";

export interface TitanNodeTarget {
  node: string;
  nodeId?: string;
  host: string;
  port: number;
  scheme: TitanNodeScheme;
  /** Server-side base URL (http(s)://host[:port]) */
  rpc: string;
  /** Human-readable endpoint for UI */
  displayUrl: string;
  /** Configured bootstrap vs local multi-node compose */
  source: "seed" | "local";
}

export interface TitanPublicConfig {
  networkName: string;
  networkId: number;
  chainIdDec: number;
  chainIdHex: string;
  rpcUrl: string;
  bootstrapUrl: string;
  isLocalDev: boolean;
  logsEnabled: boolean;
  scheme: TitanNodeScheme;
}

const DEFAULT_LOCAL_NODES: Array<{ node: string; host: string; port: number }> = [
  { node: "node1", host: "localhost", port: 9650 },
  { node: "node2", host: "localhost", port: 9652 },
  { node: "node3", host: "localhost", port: 9654 },
];

const HTTP_API_PORT = 9650;
const HTTPS_API_PORT = 443;

/** Titan mainnet defaults (network / C-chain ID 888). Override via env for other networks. */
function getChainIds(): Pick<TitanPublicConfig, "networkId" | "chainIdDec" | "chainIdHex"> {
  const chainIdDec = Number.parseInt(
    process.env.TITAN_CHAIN_ID?.trim() ||
      process.env.TITAN_NETWORK_ID?.trim() ||
      "888",
    10,
  );
  const chainIdHex =
    process.env.TITAN_CHAIN_ID_HEX?.trim() ||
    `0x${chainIdDec.toString(16)}`;
  return { networkId: chainIdDec, chainIdDec, chainIdHex };
}

export function getTitanNodeScheme(): TitanNodeScheme {
  const explicit = process.env.TITAN_NETWORK_SCHEME?.trim().toLowerCase();
  if (explicit === "https" || explicit === "http") {
    return explicit;
  }
  if (process.env.TITAN_NETWORK_TLS === "1") {
    return "https";
  }
  const bootstrap = process.env.TITAN_BOOTSTRAP_URL?.trim();
  if (bootstrap?.startsWith("https://")) {
    return "https";
  }
  const publicRpc = process.env.NEXT_PUBLIC_TITAN_RPC_URL?.trim();
  if (publicRpc?.startsWith("https://")) {
    return "https";
  }
  return "http";
}

export function defaultApiPort(scheme: TitanNodeScheme): number {
  return scheme === "https" ? HTTPS_API_PORT : HTTP_API_PORT;
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "localhost";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return trimmed;
    }
  }
  return trimmed.split(":")[0] ?? trimmed;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildNodeBaseUrl(host: string, port: number, scheme: TitanNodeScheme): string {
  const standardPort = defaultApiPort(scheme);
  if (port === standardPort) {
    return `${scheme}://${host}`;
  }
  return `${scheme}://${host}:${port}`;
}

function toTarget(
  node: string,
  host: string,
  port: number,
  source: TitanNodeTarget["source"],
  scheme: TitanNodeScheme,
  nodeId?: string,
): TitanNodeTarget {
  const rpc = buildNodeBaseUrl(host, port, scheme);
  const standardPort = defaultApiPort(scheme);
  const displayUrl = port === standardPort ? host : `${host}:${port}`;
  return {
    node,
    nodeId,
    host,
    port,
    scheme,
    rpc,
    displayUrl,
    source,
  };
}

export function getBootstrapTarget(): TitanNodeTarget | null {
  const scheme = getTitanNodeScheme();
  const raw =
    process.env.TITAN_BOOTSTRAP_URL?.trim() ||
    process.env.TITAN_NETWORK_HOST?.trim() ||
    "";

  if (!raw) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      const urlScheme: TitanNodeScheme = url.protocol === "https:" ? "https" : "http";
      const port = parsePort(url.port, defaultApiPort(urlScheme));
      return toTarget("bootstrap", url.hostname, port, "seed", urlScheme);
    } catch {
      return null;
    }
  }

  const host = normalizeHost(raw);
  const port = parsePort(process.env.TITAN_NETWORK_PORT, defaultApiPort(scheme));
  return toTarget("bootstrap", host, port, "seed", scheme);
}

/** Local multi-node compose (localhost offset ports). */
export function getLocalDevTargets(): TitanNodeTarget[] {
  return DEFAULT_LOCAL_NODES.map(({ node, host, port }) =>
    toTarget(node, host, port, "local", "http"),
  );
}

export function isLocalTitanDev(targets: TitanNodeTarget[]): boolean {
  return targets.every((t) => t.host === "localhost" || t.host === "127.0.0.1");
}

export function getTitanPublicConfig(appOrigin = ""): TitanPublicConfig {
  const bootstrap = getBootstrapTarget();
  const local = !bootstrap;
  const scheme = bootstrap?.scheme ?? "http";
  const networkName =
    process.env.TITAN_NETWORK_NAME?.trim() ||
    (local ? "Titan Local" : "Titan");

  const primary = bootstrap ?? getLocalDevTargets()[0];
  const rpcUrl =
    process.env.NEXT_PUBLIC_TITAN_RPC_URL?.trim() ||
    process.env.TITAN_RPC_URL?.trim() ||
    (local
      ? `${primary.rpc}/ext/bc/C/rpc`
      : "https://rpc.titan-network.xyz/ext/bc/C/rpc");

  const chainIds = getChainIds();

  return {
    networkName,
    networkId: chainIds.networkId,
    chainIdDec: chainIds.chainIdDec,
    chainIdHex: chainIds.chainIdHex,
    rpcUrl,
    bootstrapUrl: primary.rpc,
    isLocalDev: local,
    logsEnabled: local && process.env.TITAN_LOGS_ENABLED !== "0",
    scheme,
  };
}

async function infoRpc<T>(baseUrl: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await titanNodeFetch(`${baseUrl}/ext/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? `info.${method} failed`);
  }
  return json.result as T;
}

interface NodeIdResult {
  nodeID?: string;
}

/**
 * Resolve the single configured bootstrap node (enriched with info.getNodeID when reachable).
 * P2P peers from info.peers are Avalanche network peers, not separate Titan API endpoints.
 */
export async function discoverTitanNodes(): Promise<TitanNodeTarget[]> {
  const bootstrap = getBootstrapTarget();
  if (!bootstrap) {
    return getLocalDevTargets();
  }

  let nodeId: string | undefined;
  try {
    const selfId = await infoRpc<NodeIdResult>(bootstrap.rpc, "info.getNodeID");
    nodeId = selfId.nodeID;
  } catch {
    // nodeId optional — health checks still use the configured bootstrap host
  }

  const label = nodeId ? nodeId.replace(/^NodeID-/, "").slice(0, 12) : bootstrap.node;

  return [
    toTarget(label, bootstrap.host, bootstrap.port, "seed", bootstrap.scheme, nodeId),
  ];
}