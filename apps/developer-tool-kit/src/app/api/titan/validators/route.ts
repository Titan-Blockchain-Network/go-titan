import { NextResponse } from "next/server";

import { buildValidatorAddressLabels } from "@/lib/titan/address-labels";
import { discoverTitanNodes } from "@/lib/titan/network-config";
import { enrichNodeFields, getRegistryNodes } from "@/lib/titan/node-registry";
import { titanNodeFetch } from "@/lib/titan/titan-node-fetch";

export const dynamic = "force-dynamic";

const NANO_TITAN = 1_000_000_000;

interface PlatformValidator {
  nodeID?: string;
  weight?: string;
  startTime?: string;
  endTime?: string;
  uptime?: string;
  connected?: boolean;
  delegationFee?: string;
  potentialReward?: string;
  delegatorCount?: string;
  delegatorWeight?: string;
  validationRewardOwner?: { addresses?: string[] };
  delegationRewardOwner?: { addresses?: string[] };
}

async function platformRpc<T>(baseUrl: string, method: string, params: unknown = {}): Promise<T> {
  const res = await titanNodeFetch(`${baseUrl}/ext/bc/P`, {
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

async function infoRpc<T>(baseUrl: string, method: string, params: unknown = {}): Promise<T> {
  const res = await titanNodeFetch(`${baseUrl}/ext/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? `${method} failed`);
  }
  return json.result as T;
}

function nanoToTitan(raw?: string): number {
  if (!raw) return 0;
  try {
    return Number(BigInt(raw)) / NANO_TITAN;
  } catch {
    return 0;
  }
}

function parseUptimePercent(raw?: string): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function collectRewardAddresses(v: PlatformValidator): string[] {
  const addrs = new Set<string>();
  for (const owner of [v.validationRewardOwner, v.delegationRewardOwner]) {
    for (const a of owner?.addresses ?? []) {
      if (a?.startsWith("0x")) addrs.add(a);
    }
  }
  return [...addrs];
}

export async function GET() {
  const nodes = await discoverTitanNodes();
  const primary = nodes[0];
  if (!primary) {
    return NextResponse.json({ error: "No Titan node configured" }, { status: 503 });
  }

  const base = primary.rpc;
  const errors: string[] = [];

  let validators: PlatformValidator[] = [];
  let pendingValidators: PlatformValidator[] = [];
  let pChainHeight: number | null = null;
  let networkId: number | null = null;
  let nodeVersion: string | null = null;
  const bootstrapped: Record<string, boolean> = {};

  try {
    const current = await platformRpc<{ validators?: PlatformValidator[] }>(
      base,
      "platform.getCurrentValidators",
      {},
    );
    validators = current.validators ?? [];
  } catch (e) {
    errors.push(`validators: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const pending = await platformRpc<{ validators?: PlatformValidator[] }>(
      base,
      "platform.getPendingValidators",
      {},
    );
    pendingValidators = pending.validators ?? [];
  } catch {
    /* pending set is optional on young networks */
  }

  try {
    const height = await platformRpc<{ height?: string }>(base, "platform.getHeight");
    pChainHeight = height.height ? Number.parseInt(height.height, 10) : null;
  } catch (e) {
    errors.push(`p-height: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const net = await infoRpc<{ networkID?: number }>(base, "info.getNetworkID");
    networkId = net.networkID ?? null;
  } catch {
    /* optional */
  }

  try {
    const ver = await infoRpc<{ version?: string }>(base, "info.getNodeVersion");
    nodeVersion = ver.version ?? null;
  } catch {
    /* optional */
  }

  for (const chain of ["C", "P", "X"] as const) {
    try {
      const boot = await infoRpc<{ isBootstrapped?: boolean }>(base, "info.isBootstrapped", { chain });
      bootstrapped[chain] = Boolean(boot.isBootstrapped);
    } catch {
      bootstrapped[chain] = false;
    }
  }

  const normalized = validators.map((v) => {
    const stakeTitan = nanoToTitan(v.weight);
    const delegatorWeightTitan = nanoToTitan(v.delegatorWeight);
    const rewardAddresses = collectRewardAddresses(v);
    const registry = enrichNodeFields({
      nodeId: v.nodeID,
      fallback: v.nodeID?.replace(/^NodeID-/, "").slice(0, 12),
    });
    return {
      nodeID: v.nodeID ?? "—",
      displayName: registry.displayName,
      registryId: registry.registryId,
      registryRole: registry.registryRole,
      registryDroplet: registry.registryDroplet,
      stakeTitan,
      delegatorWeightTitan,
      delegatorCount: Number(v.delegatorCount ?? 0),
      totalWeightTitan: stakeTitan + delegatorWeightTitan,
      stakeNano: v.weight ?? "0",
      startTime: v.startTime ? Number.parseInt(v.startTime, 10) : null,
      endTime: v.endTime ? Number.parseInt(v.endTime, 10) : null,
      uptimePercent: parseUptimePercent(v.uptime),
      connected: v.connected ?? null,
      delegationFeePercent: v.delegationFee
        ? Number.parseFloat(v.delegationFee) / 10_000
        : null,
      potentialRewardTitan: nanoToTitan(v.potentialReward),
      rewardAddresses,
    };
  });

  const pending = pendingValidators.map((v) => {
    const registry = enrichNodeFields({
      nodeId: v.nodeID,
      fallback: v.nodeID?.replace(/^NodeID-/, "").slice(0, 12),
    });
    return {
      nodeID: v.nodeID ?? "—",
      displayName: registry.displayName,
      stakeTitan: nanoToTitan(v.weight),
    startTime: v.startTime ? Number.parseInt(v.startTime, 10) : null,
    endTime: v.endTime ? Number.parseInt(v.endTime, 10) : null,
    };
  });

  const totalStakedTitan = normalized.reduce((sum, v) => sum + v.stakeTitan, 0);
  const addressLabels = buildValidatorAddressLabels(
    normalized.map((v) => ({
      nodeID: v.nodeID,
      name: v.displayName,
      rewardAddresses: v.rewardAddresses,
    })),
  );

  return NextResponse.json({
    validatorCount: normalized.length,
    pendingCount: pending.length,
    totalStakedTitan,
    pChainHeight,
    networkId,
    nodeVersion,
    bootstrapped,
    validators: normalized,
    pendingValidators: pending,
    addressLabels,
    registry: getRegistryNodes(),
    errors: errors.length ? errors : undefined,
  });
}