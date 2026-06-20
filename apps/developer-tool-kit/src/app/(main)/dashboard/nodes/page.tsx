"use client";

import { useEffect, useState } from "react";

import { Loader2, Server, Users } from "lucide-react";

import { RpcSyncPanel } from "@/app/(main)/dashboard/activity/_components/rpc-sync-panel";
import { meshLabelForNode } from "@/lib/titan/node-display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface NodeInfo {
  node: string;
  nodeId?: string;
  displayName?: string;
  registryId?: string;
  registryRole?: string;
  registryDroplet?: string;
  registryIp?: string;
  host?: string;
  port: number;
  displayUrl?: string;
  source?: "seed" | "local" | "peer";
  discoveryMethod?: "bootstrap" | "p2p-gossip" | "direct-probe";
  inMesh?: boolean;
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
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [meshPeerCount, setMeshPeerCount] = useState<number | null>(null);
  const [networkHeadBlock, setNetworkHeadBlock] = useState<string | null>(null);
  const [publicRpcUrl, setPublicRpcUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [nodesRes, configRes] = await Promise.all([
        fetch("/api/titan/rpc"),
        fetch("/api/titan/config"),
      ]);
      const j = await nodesRes.json();
      setNodes(j.nodes ?? []);
      setMeshPeerCount(typeof j.meshPeerCount === "number" ? j.meshPeerCount : null);
      setNetworkHeadBlock(typeof j.networkHeadBlock === "string" ? j.networkHeadBlock : null);
      if (configRes.ok) {
        const cfg = (await configRes.json()) as { rpcUrl?: string };
        setPublicRpcUrl(cfg.rpcUrl ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const headDisplay = networkHeadBlock
    ? Number(networkHeadBlock).toLocaleString()
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Server className="size-6 text-primary" />
          Nodes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Validator mesh, RPC endpoints, and C-Chain sync
          {headDisplay ? ` · head #${headDisplay}` : ""}
          {meshPeerCount != null ? ` · ${meshPeerCount} P2P peers` : ""}
        </p>
      </div>

      {nodes.length > 0 && (
        <RpcSyncPanel
          nodes={nodes}
          loading={loading}
          headBlock={networkHeadBlock ?? headDisplay}
          meshPeerCount={meshPeerCount}
        />
      )}

      {loading && nodes.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading node mesh…
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {nodes.length === 0 && !loading ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No nodes discovered. Check Explorer env vars (<code className="font-mono text-xs">TITAN_BOOTSTRAP_URL</code>
              ) and redeploy.
            </CardContent>
          </Card>
        ) : null}
        {nodes.map((info) => {
          const isPeer = info.source === "peer";
          const label = info.displayName ?? info.nodeId ?? info.node;
          const endpoint =
            info.registryIp ?? info.displayUrl ?? `${info.host ?? "unknown"}:${info.port}`;
          return (
            <Card key={info.nodeId ?? info.node}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <Server className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base break-all">{label}</CardTitle>
                    <p className="text-xs text-muted-foreground break-all">
                      {info.registryDroplet && <span className="font-mono">{info.registryDroplet} · </span>}
                      <span className="font-mono">{endpoint}</span>
                      {info.registryRole ? ` · ${info.registryRole}` : ""}
                    </p>
                  </div>
                  {isPeer ? (
                    <Badge className="shrink-0 bg-blue-600">P2P</Badge>
                  ) : info.healthy ? (
                    <Badge className="shrink-0 bg-emerald-600">Healthy</Badge>
                  ) : (
                    <Badge variant="destructive" className="shrink-0">
                      Down
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {isPeer ? (
                  <>
                    <Row label="Connectivity" value={meshLabelForNode(info, meshPeerCount)} />
                    <Row label="Version" value={info.version ?? "—"} mono />
                    <Row
                      label="Uptime"
                      value={info.observedUptime !== undefined ? `${info.observedUptime}%` : "—"}
                    />
                    <p className="text-xs text-muted-foreground pt-1">
                      Seen via P2P gossip — block height shown on sync panel above when probed.
                    </p>
                  </>
                ) : (
                  <>
                    <Row
                      label="Connectivity"
                      value={meshLabelForNode(info, meshPeerCount)}
                      icon={<Users className="size-3" />}
                    />
                    <Row label="Block" value={info.blockNumber ?? "—"} mono />
                    <Row label="Chain ID" value={info.chainId ?? "—"} mono />
                    <Row label="Gas" value={info.gasPrice ?? "—"} mono />
                    <Row
                      label="C-Chain RPC"
                      value={
                        info.discoveryMethod === "bootstrap" && publicRpcUrl
                          ? publicRpcUrl
                          : `http://${info.host ?? "localhost"}:${info.port}/ext/bc/C/rpc`
                      }
                      mono
                      small
                    />
                    {info.error && <p className="text-xs text-destructive break-all">{info.error}</p>}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  small,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={`${mono ? "font-mono" : "font-medium"} ${small ? "text-xs" : ""} break-all text-right`}
      >
        {value}
      </span>
    </div>
  );
}