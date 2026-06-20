import registry from "@/config/titan-node-registry.json";

export interface TitanRegistryNode {
  id: string;
  name: string;
  droplet: string;
  role: string;
  region: string;
  ip: string;
  nodeId: string | null;
  hostnames: string[];
  spec?: string;
  tags?: string[];
}

export interface TitanRegistryMatch {
  id: string;
  name: string;
  droplet: string;
  role: string;
  region: string;
  ip: string;
  nodeId: string | null;
}

export interface NodeLookupInput {
  nodeId?: string | null;
  host?: string | null;
  publicIp?: string | null;
  displayUrl?: string | null;
}

const nodes = registry.nodes as TitanRegistryNode[];

const byNodeId = new Map<string, TitanRegistryNode>();
const byIp = new Map<string, TitanRegistryNode>();
const byHostname = new Map<string, TitanRegistryNode>();

for (const entry of nodes) {
  if (entry.nodeId) {
    byNodeId.set(entry.nodeId, entry);
  }
  byIp.set(entry.ip, entry);
  for (const host of entry.hostnames) {
    byHostname.set(host.toLowerCase(), entry);
  }
}

/** All known pantheon nodes (for docs / API). */
export function getRegistryNodes(): TitanRegistryNode[] {
  return nodes;
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return trimmed;
    }
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(trimmed)) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

function hostsFromInput(input: NodeLookupInput): string[] {
  const hosts = new Set<string>();
  for (const raw of [input.host, input.publicIp, input.displayUrl]) {
    if (!raw?.trim()) continue;
    hosts.add(normalizeHost(raw));
  }
  return [...hosts];
}

/**
 * Resolve a friendly pantheon name from NodeID, public IP, or hostname.
 * P2P peers are matched primarily by IP from `publicIP` / `ip`.
 */
export function resolveRegistryNode(input: NodeLookupInput): TitanRegistryMatch | null {
  const nodeId = input.nodeId?.trim();
  if (nodeId && byNodeId.has(nodeId)) {
    return toMatch(byNodeId.get(nodeId)!);
  }

  for (const host of hostsFromInput(input)) {
    if (byIp.has(host)) {
      return toMatch(byIp.get(host)!);
    }
    if (byHostname.has(host)) {
      return toMatch(byHostname.get(host)!);
    }
  }

  return null;
}

function toMatch(entry: TitanRegistryNode): TitanRegistryMatch {
  return {
    id: entry.id,
    name: entry.name,
    droplet: entry.droplet,
    role: entry.role,
    region: entry.region,
    ip: entry.ip,
    nodeId: entry.nodeId,
  };
}

/** Human-facing label: pantheon name, or shortened NodeID fallback. */
export function formatNodeDisplayName(input: NodeLookupInput & { fallback?: string }): string {
  const hit = resolveRegistryNode(input);
  if (hit) return hit.name;
  const nodeId = input.nodeId?.trim();
  if (nodeId) {
    return nodeId.replace(/^NodeID-/, "").slice(0, 12);
  }
  return input.fallback?.trim() || "Unknown node";
}

export interface EnrichedNodeFields {
  displayName: string;
  registryId?: string;
  registryRole?: string;
  registryDroplet?: string;
  registryIp?: string;
}

export function enrichNodeFields(input: NodeLookupInput & { fallback?: string }): EnrichedNodeFields {
  const hit = resolveRegistryNode(input);
  const displayName = formatNodeDisplayName(input);
  if (!hit) {
    return { displayName };
  }
  return {
    displayName: hit.name,
    registryId: hit.id,
    registryRole: hit.role,
    registryDroplet: hit.droplet,
    registryIp: hit.ip,
  };
}