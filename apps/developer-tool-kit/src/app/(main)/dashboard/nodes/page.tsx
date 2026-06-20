"use client";

import { useEffect, useState } from "react";

import { Activity, Loader2, RefreshCw, Server, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface NodeInfo {
  node: string;
  nodeId?: string;
  host?: string;
  port: number;
  displayUrl?: string;
  source?: "seed" | "local" | "peer";
  healthy: boolean;
  peers: number;
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
  const [loading, setLoading] = useState(true);
  const [publicRpcUrl, setPublicRpcUrl] = useState<string | null>(null);
  const [bootstrapUrl, setBootstrapUrl] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [nodesRes, configRes] = await Promise.all([
        fetch("/api/titan/rpc"),
        fetch("/api/titan/config"),
      ]);
      const j = await nodesRes.json();
      setNodes(j.nodes ?? []);
      if (configRes.ok) {
        const cfg = (await configRes.json()) as { rpcUrl?: string; bootstrapUrl?: string };
        setPublicRpcUrl(cfg.rpcUrl ?? null);
        setBootstrapUrl(cfg.bootstrapUrl ?? null);
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

  const apiNodes = nodes.filter((n) => n.source !== "peer" && n.blockNumber);
  const blockHeights = apiNodes
    .map((n) => Number.parseInt(n.blockNumber ?? "0", 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxBlock = blockHeights.length ? Math.max(...blockHeights) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nodes</h1>
          <p className="text-sm text-muted-foreground">
            Configured nodes with full API metrics, plus P2P peers discovered via{" "}
            <code className="font-mono text-xs">info.peers</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {maxBlock != null && apiNodes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">C-chain sync</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 text-left font-medium">Node</th>
                  <th className="py-2 text-right font-medium">Block</th>
                  <th className="py-2 text-right font-medium">Lag</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {apiNodes.map((info) => {
                  const height = Number.parseInt(info.blockNumber ?? "0", 10);
                  const lag = Number.isFinite(height) ? Math.max(0, maxBlock - height) : null;
                  const label = info.nodeId ?? info.node;
                  return (
                    <tr key={info.nodeId ?? info.node}>
                      <td className="py-2 font-mono text-xs">{label}</td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {info.blockNumber ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {lag === 0 ? (
                          <Badge className="bg-green-600">Synced</Badge>
                        ) : lag != null ? (
                          <span className="text-amber-600">{lag} behind</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-3">
              Head across probed API nodes: #{maxBlock.toLocaleString()}. P2P peers below are not HTTP-probed for block
              height in production.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {nodes.length === 0 && !loading ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground space-y-2">
              <p>
                No nodes discovered. On Vercel set{" "}
                <code className="font-mono">TITAN_NETWORK_HOST=167.99.239.111</code>,{" "}
                <code className="font-mono">TITAN_NETWORK_SCHEME=https</code>,{" "}
                <code className="font-mono">TITAN_NETWORK_PORT=443</code>, and{" "}
                <code className="font-mono">TITAN_TLS_INSECURE_SKIP_VERIFY=1</code> (self-signed), then
                redeploy.
              </p>
            </CardContent>
          </Card>
        ) : null}
        {nodes.map((info) => {
          const isPeer = info.source === "peer";
          const label = info.nodeId ?? info.node;
          const endpoint = info.displayUrl ?? `${info.host ?? "unknown"}:${info.port}`;
          const sourceLabel =
            info.source === "seed"
              ? "bootstrap"
              : info.source === "local"
                ? "local"
                : info.source === "peer"
                  ? "P2P peer"
                  : info.source;
          return (
            <Card key={info.nodeId ?? info.node}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-mono text-sm break-all">
                      {label}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground font-mono break-all">
                      {endpoint}
                      {sourceLabel ? ` · ${sourceLabel}` : ""}
                    </p>
                  </div>
                  {isPeer ? (
                    <Badge className="bg-blue-500 text-white shrink-0">Connected</Badge>
                  ) : info.healthy ? (
                    <Badge className="bg-green-500 text-white shrink-0">Healthy</Badge>
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
                    <Row label="Public IP" value={info.publicIp ?? endpoint} mono />
                    <Row label="Version" value={info.version ?? "—"} mono />
                    <Row
                      label="Observed uptime"
                      value={
                        info.observedUptime !== undefined
                          ? `${info.observedUptime}%`
                          : "—"
                      }
                    />
                    <Row
                      label="Last sent"
                      value={formatPeerTime(info.lastSent)}
                      icon={<Activity className="h-3 w-3" />}
                      mono
                      small
                    />
                    <Row
                      label="Last received"
                      value={formatPeerTime(info.lastReceived)}
                      mono
                      small
                    />
                    <Row
                      label="Benched chains"
                      value={
                        info.benched?.length ? String(info.benched.length) : "0"
                      }
                    />
                    <p className="text-xs text-muted-foreground pt-1">
                      Discovered via P2P — no HTTP API configured for this node.
                    </p>
                  </>
                ) : (
                  <>
                    <Row label="Public IP" value={info.publicIp ?? endpoint} mono />
                    <Row
                      label="Peers"
                      value={String(info.peers)}
                      icon={<Users className="h-3 w-3" />}
                    />
                    <Row label="Chain ID" value={info.chainId ?? "—"} mono />
                    <Row label="Latest Block" value={info.blockNumber ?? "—"} mono />
                    <Row label="Gas Price" value={info.gasPrice ?? "—"} mono />
                    <Row
                      label="RPC (MetaMask)"
                      value={
                        publicRpcUrl ??
                        `http://${info.host ?? "localhost"}:${info.port}/ext/bc/C/rpc`
                      }
                      mono
                      small
                    />
                    <Row
                      label="API probe"
                      value={
                        bootstrapUrl && info.source === "seed"
                          ? bootstrapUrl
                          : `${info.port === 443 ? "https" : "http"}://${info.host ?? "localhost"}${info.port === 443 || info.port === 80 ? "" : `:${info.port}`}`
                      }
                      mono
                      small
                    />
                    {info.error && (
                      <p className="text-xs text-red-500 break-all">{info.error}</p>
                    )}
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

function formatPeerTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
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
    <div className="flex justify-between items-start gap-2">
      <span className="text-muted-foreground shrink-0 flex items-center gap-1">
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
