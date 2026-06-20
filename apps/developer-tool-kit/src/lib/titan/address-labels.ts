/** Well-known C-chain addresses on Titan mainnet (override via env). */
const STATIC_LABELS: Record<string, { label: string; kind: "treasury" | "system" | "contract" }> = {
  "0x1b37e0c63CB3B385684B9525C899087Fad9042eE": {
    label: "Network Treasury",
    kind: "treasury",
  },
};

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

export function getEnvTreasuryAddress(): string | null {
  const raw = process.env.TITAN_TREASURY_ADDRESS?.trim();
  return raw ? normalizeAddress(raw) : null;
}

export function getStaticAddressMeta(address: string): { label: string; kind: string } | null {
  const key = normalizeAddress(address);
  const envTreasury = getEnvTreasuryAddress();
  if (envTreasury && key === envTreasury) {
    return { label: "Network Treasury", kind: "treasury" };
  }
  const hit = STATIC_LABELS[key];
  return hit ? { label: hit.label, kind: hit.kind } : null;
}

export interface ValidatorLabelSource {
  nodeID: string;
  rewardAddresses?: string[];
  name?: string;
}

/** Map validator reward P-chain / C-chain addresses to human labels. */
export function buildValidatorAddressLabels(sources: ValidatorLabelSource[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of sources) {
    const shortId = v.nodeID.replace(/^NodeID-/, "").slice(0, 12);
    const base = v.name?.trim() || `Validator ${shortId}`;
    for (const addr of v.rewardAddresses ?? []) {
      if (!addr?.startsWith("0x")) continue;
      out[normalizeAddress(addr)] = `${base} (rewards)`;
    }
  }
  return out;
}

export function resolveAddressLabel(
  address: string,
  dynamicLabels: Record<string, string> = {},
): { label: string | null; kind: string | null } {
  const key = normalizeAddress(address);
  if (dynamicLabels[key]) {
    return { label: dynamicLabels[key], kind: "validator" };
  }
  const staticMeta = getStaticAddressMeta(address);
  if (staticMeta) {
    return { label: staticMeta.label, kind: staticMeta.kind };
  }
  return { label: null, kind: null };
}

export function isContractBytecode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const normalized = code.trim();
  return normalized.length > 2 && normalized !== "0x";
}

export function bytecodeSizeBytes(code: string): number {
  const hex = code.startsWith("0x") ? code.slice(2) : code;
  if (!hex || hex === "0") return 0;
  return Math.floor(hex.length / 2);
}