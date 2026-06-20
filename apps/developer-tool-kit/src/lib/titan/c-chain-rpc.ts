import { discoverTitanNodes, getTitanPublicConfig } from "@/lib/titan/network-config";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

export async function cChainRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const nodes = await discoverTitanNodes();
  const fallback = getTitanPublicConfig("https://explorer.titan-network.xyz").rpcUrl;

  const url =
    nodes[0] != null ? `${nodes[0].rpc}/ext/bc/C/rpc` : fallback;

  const res = await titanNodeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? `${method} failed`);
  }
  return json.result as T;
}