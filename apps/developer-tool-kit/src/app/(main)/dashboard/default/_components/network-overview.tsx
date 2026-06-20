"use client";

import Link from "next/link";
import { ArrowRight, Blocks, Network, Rocket, Server } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { blockLabelForNode, meshLabelForNode } from "@/lib/titan/node-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNetworkStatusStore } from "@/stores/titan/network-status-store";

const QUICK_LINKS = [
  { href: "/dashboard/activity", label: "Chain Explorer", icon: Blocks, desc: "Blocks & transactions" },
  { href: "/dashboard/nodes", label: "Nodes", icon: Server, desc: "RPC sync & validators" },
  { href: "/dashboard/ecosystem", label: "Launchpad", icon: Rocket, desc: "Apps & escrow" },
] as const;

export function NetworkOverview() {
  const nodes = useNetworkStatusStore((s) => s.nodes);
  const meshPeerCount = useNetworkStatusStore((s) => s.meshPeerCount);
  const rpcProbeNode = useNetworkStatusStore((s) => s.rpcProbeNode);
  const runtime = useNetworkStatusStore((s) => s.runtime);

  const bootstrap = nodes.find((n) => n.discoveryMethod === "bootstrap");
  const networkHead = bootstrap?.blockNumber ?? nodes.find((n) => n.blockNumber)?.blockNumber ?? null;
  const validators = nodes.filter(
    (n) => n.inMesh || n.discoveryMethod === "bootstrap" || n.discoveryMethod === "direct-probe",
  );
  const healthyCount = nodes.filter((n) => n.healthy).length;
  const operational = healthyCount > 0 && networkHead != null;

  const lineup = [...nodes]
    .filter((n) => n.discoveryMethod !== "p2p-gossip" || n.displayName)
    .sort((a, b) => {
      const rank = (n: (typeof nodes)[0]) => {
        if (n.discoveryMethod === "bootstrap") return 0;
        if (n.discoveryMethod === "direct-probe") return 1;
        return 2;
      };
      return rank(a) - rank(b) || (a.displayName ?? a.node).localeCompare(b.displayName ?? b.node);
    })
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-linear-to-br from-primary/5 via-background to-muted/30 p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Network className="size-6 text-primary" />
              {runtime?.networkName ?? APP_CONFIG.titan.networkName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Chain {APP_CONFIG.titan.chainIdDec} ·{" "}
              {validators.length > 0 ? `${validators.length} validators live` : "Syncing mesh"}
              {meshPeerCount != null && rpcProbeNode
                ? ` · ${meshPeerCount} P2P peers on ${rpcProbeNode}`
                : ""}
            </p>
          </div>
          <Badge variant={operational ? "default" : "outline"} className="w-fit gap-1.5 px-3 py-1">
            <span
              className={`size-2 rounded-full ${operational ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            {operational ? "Operational" : "Syncing"}
          </Badge>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric label="C-Chain head" value={networkHead ?? "—"} />
          <Metric
            label="Mesh"
            value={meshPeerCount != null ? `${meshPeerCount} peers` : "—"}
            sub="on public RPC node"
          />
          <Metric
            label="Probed"
            value={`${healthyCount}/${nodes.length || "—"}`}
            sub="API healthy"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group block">
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/20">
                <CardContent className="flex items-center gap-3 pt-5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {lineup.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Validator lineup</CardTitle>
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link href="/dashboard/nodes">
                RPC & node details
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {lineup.map((info) => {
                const block = blockLabelForNode(info, networkHead);
                return (
                  <div
                    key={info.nodeId ?? info.node}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${info.healthy ? "bg-emerald-500" : "bg-amber-500"}`}
                      />
                      <span className="font-medium truncate">
                        {info.displayName ?? info.nodeId ?? info.node}
                      </span>
                      {info.discoveryMethod === "bootstrap" && (
                        <Badge variant="secondary" className="text-[10px]">
                          RPC
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{meshLabelForNode(info, meshPeerCount)}</span>
                      <span className="font-mono tabular-nums">
                        #{block.text}
                        {block.shared && <span className="ml-1 font-sans">(head)</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Wallet & RPC setup →{" "}
        <Link href="/dashboard/developers" className="text-foreground underline-offset-4 hover:underline">
          Developer Connection
        </Link>
      </p>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold text-lg tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}