export interface NodeMeshDisplayInput {
  discoveryMethod?: "bootstrap" | "p2p-gossip" | "direct-probe";
  inMesh?: boolean;
  peers?: number;
  healthy?: boolean;
  blockNumber?: string;
  source?: "seed" | "local" | "peer";
}

/** Human label for mesh / peer connectivity — avoids repeating bootstrap P2P count on every row. */
export function meshLabelForNode(
  node: NodeMeshDisplayInput,
  meshPeerCount: number | null,
): string {
  if (node.discoveryMethod === "bootstrap" || node.source === "seed") {
    return meshPeerCount != null
      ? `${meshPeerCount} P2P connections`
      : "Public RPC · network anchor";
  }
  if (node.discoveryMethod === "direct-probe") {
    return typeof node.peers === "number" ? `${node.peers} peers · API probed` : "API probed";
  }
  if (node.discoveryMethod === "p2p-gossip" || node.source === "peer") {
    return "In validator mesh (P2P)";
  }
  if (node.inMesh) {
    return "In mesh";
  }
  return "—";
}

export function blockLabelForNode(
  node: NodeMeshDisplayInput,
  networkHead?: string | null,
): { text: string; shared: boolean } {
  const block = node.blockNumber;
  if (!block) return { text: "—", shared: false };
  if (node.discoveryMethod === "p2p-gossip" && networkHead && block === networkHead) {
    return { text: block, shared: true };
  }
  return { text: block, shared: false };
}