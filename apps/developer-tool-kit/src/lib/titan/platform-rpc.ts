import { discoverTitanNodes } from "@/lib/titan/network-config";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

export const NANO_TITAN = 1_000_000_000;

export async function getPrimaryNodeBaseUrl(): Promise<string> {
  const nodes = await discoverTitanNodes();
  const primary = nodes[0];
  if (!primary?.rpc) {
    throw new Error("No Titan node configured");
  }
  return primary.rpc;
}

export async function platformRpc<T>(
  method: string,
  params: unknown = {},
  baseUrl?: string,
): Promise<T> {
  const base = baseUrl ?? (await getPrimaryNodeBaseUrl());
  const res = await titanNodeFetch(`${base}/ext/bc/P`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? `${method} failed`);
  }
  return json.result as T;
}

export function nanoToTitan(raw?: string | bigint | null): number {
  if (raw == null || raw === "") return 0;
  try {
    return Number(BigInt(raw)) / NANO_TITAN;
  } catch {
    return 0;
  }
}

export function titanToNano(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid TITAN amount");
  }
  return BigInt(Math.round(amount * NANO_TITAN));
}