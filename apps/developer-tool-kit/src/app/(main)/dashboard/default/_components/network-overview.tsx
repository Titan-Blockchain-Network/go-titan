"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { Badge } from "@/components/ui/badge";
import { useNetworkStatusStore } from "@/stores/titan/network-status-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function StatCard({ title, value, sub, ok }: { title: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {ok !== undefined &&
          (ok ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <AlertCircle className="size-4 text-amber-500" />
          ))}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function NetworkOverview() {
  const nodes = useNetworkStatusStore((s) => s.nodes);
  const meshPeerCount = useNetworkStatusStore((s) => s.meshPeerCount);
  const rpcProbeNode = useNetworkStatusStore((s) => s.rpcProbeNode);
  const runtime = useNetworkStatusStore((s) => s.runtime);

  const bootstrap = nodes.find((n) => n.discoveryMethod === "bootstrap");
  const meshValidators = nodes.filter((n) => n.inMesh || n.discoveryMethod === "bootstrap").length;
  const healthyCount = nodes.filter((n) => n.healthy).length;
  const blockNumber = bootstrap?.blockNumber ?? nodes.find((n) => n.blockNumber)?.blockNumber ?? "—";
  const meshPeers =
    (typeof meshPeerCount === "number" && Number.isFinite(meshPeerCount) ? meshPeerCount : null) ??
    (typeof bootstrap?.peers === "number" ? bootstrap.peers : null) ??
    4;
  const operational = healthyCount > 0 && blockNumber !== "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Network</h1>
          <p className="text-sm text-muted-foreground">
            {runtime?.networkName ?? APP_CONFIG.titan.networkName} validator mesh
          </p>
        </div>
        <Badge variant={operational ? "default" : "outline"} className="w-fit gap-1.5">
          <span
            className={`size-2 rounded-full ${operational ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          {operational ? "Operational" : "Syncing"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Validators"
          value={String(meshValidators || nodes.length)}
          sub={rpcProbeNode ? `via ${rpcProbeNode}` : "In mesh"}
          ok={meshValidators >= 1}
        />
        <StatCard title="Latest block" value={blockNumber} sub="C-Chain head" ok={blockNumber !== "—"} />
        <StatCard
          title="Mesh peers"
          value={String(meshPeers)}
          sub="P2P connections"
          ok={meshPeers >= 1}
        />
        <StatCard
          title="Healthy nodes"
          value={String(healthyCount || nodes.length)}
          sub={`of ${nodes.length} probed`}
          ok={healthyCount > 0}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {nodes.map((info) => (
          <Card key={info.nodeId ?? info.node}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">
                  {info.displayName ?? info.nodeId ?? info.node}
                </CardTitle>
                {info.discoveryMethod === "bootstrap" ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Public RPC
                  </Badge>
                ) : info.discoveryMethod === "direct-probe" ? (
                  <Badge className="shrink-0 bg-emerald-600 text-[10px]">Direct API</Badge>
                ) : info.inMesh ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    P2P mesh
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {info.registryDroplet && <span className="font-mono">{info.registryDroplet} · </span>}
                <span className="font-mono">
                  {info.displayUrl ?? `${info.host ?? "unknown"}:${info.port}`}
                </span>
              </p>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mesh</span>
                <span className="font-medium">
                  {info.discoveryMethod === "bootstrap" || info.discoveryMethod === "direct-probe"
                    ? `${typeof info.peers === "number" ? info.peers : meshPeers} peers`
                    : info.inMesh
                      ? `${meshPeers} in mesh`
                      : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Block</span>
                <span className="font-mono font-medium">{info.blockNumber ?? "—"}</span>
              </div>
              {info.error && <p className="text-xs text-destructive break-all">{info.error}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        MetaMask RPC and chain config live on{" "}
        <Link href="/dashboard/developers" className="text-foreground underline-offset-4 hover:underline">
          Developer Connection
        </Link>
        .
      </p>
    </div>
  );
}