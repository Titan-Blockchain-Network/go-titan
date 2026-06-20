"use client";

import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { meshLabelForNode } from "@/lib/titan/node-display";
import { cn } from "@/lib/utils";

export interface RpcSyncNode {
  node: string;
  nodeId?: string;
  displayName?: string;
  healthy: boolean;
  blockNumber?: string;
  discoveryMethod?: "bootstrap" | "p2p-gossip" | "direct-probe";
  inMesh?: boolean;
  peers?: number;
}

function nodeRole(node: RpcSyncNode): { label: string; variant: "default" | "secondary" | "outline" } {
  if (node.discoveryMethod === "bootstrap") {
    return { label: "Public RPC", variant: "default" };
  }
  if (node.discoveryMethod === "direct-probe") {
    return { label: "Direct", variant: "secondary" };
  }
  if (node.inMesh) {
    return { label: "Mesh", variant: "outline" };
  }
  return { label: "Peer", variant: "outline" };
}

function sortNodes(nodes: RpcSyncNode[]): RpcSyncNode[] {
  const rank = (n: RpcSyncNode) => {
    if (n.discoveryMethod === "bootstrap") return 0;
    if (n.discoveryMethod === "direct-probe") return 1;
    if (n.inMesh) return 2;
    return 3;
  };
  return [...nodes].sort((a, b) => rank(a) - rank(b));
}

function normalizeBlock(value?: string): string | null {
  if (!value) return null;
  const digits = value.replace(/,/g, "");
  return digits.length > 0 ? digits : null;
}

export function RpcSyncPanel({
  nodes,
  loading,
  headBlock,
  meshPeerCount = null,
}: {
  nodes: RpcSyncNode[];
  loading: boolean;
  headBlock?: string | null;
  meshPeerCount?: number | null;
}) {
  if (nodes.length === 0) return null;

  const sorted = sortNodes(nodes);
  const head = normalizeBlock(headBlock ?? undefined) ?? normalizeBlock(sorted.find((n) => n.blockNumber)?.blockNumber);
  const blocks = sorted.map((n) => normalizeBlock(n.blockNumber)).filter((b): b is string => Boolean(b));
  const inSync = head != null && blocks.length > 0 && blocks.every((b) => b === head);

  return (
    <div className="rounded-lg border bg-muted/25 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              inSync ? "bg-emerald-500" : loading ? "bg-muted-foreground/40" : "bg-amber-500",
            )}
          />
          Validator RPC sync
          <span className="font-normal text-muted-foreground">
            {sorted.length} node{sorted.length === 1 ? "" : "s"}
            {inSync ? " · aligned" : head ? " · checking" : ""}
          </span>
        </div>
        {head && (
          <span className="font-mono text-xs text-muted-foreground">
            head #{Number(head).toLocaleString()}
          </span>
        )}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {sorted.map((node) => {
          const name = node.displayName ?? node.node;
          const block = normalizeBlock(node.blockNumber);
          const synced = head != null && block != null && block === head;
          const role = nodeRole(node);

          return (
            <div
              key={node.nodeId ?? node.node}
              className="flex min-w-0 items-center gap-2.5 rounded-md border bg-background px-3 py-2.5"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  !node.healthy ? "bg-destructive" : synced ? "bg-emerald-500" : "bg-amber-500",
                )}
                title={node.healthy ? (synced ? "Synced" : "Behind head") : "Unreachable"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {block ? `#${Number(block).toLocaleString()}` : "—"}
                  {block && head && block !== head && (
                    <span className="ml-1 font-sans text-amber-600">
                      ({Number(head) - Number(block)} behind)
                    </span>
                  )}
                  {node.discoveryMethod === "p2p-gossip" && block && head && block === head && (
                    <span className="ml-1 font-sans text-[10px]">(head)</span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {meshLabelForNode(node, meshPeerCount)}
                </p>
              </div>
              <Badge variant={role.variant} className="shrink-0 px-1.5 text-[10px]">
                {role.label}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}