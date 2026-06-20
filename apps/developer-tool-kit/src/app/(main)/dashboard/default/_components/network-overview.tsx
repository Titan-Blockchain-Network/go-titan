"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app-config";
import { shortAddress } from "@/lib/titan/format";
import { Badge } from "@/components/ui/badge";
import type { TitanNodeStatus } from "@/app/api/titan/rpc/route";
import { isOnTitanChain, isWalletConnected, useWalletStore } from "@/stores/wallet/wallet-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type NodeHealth = Pick<
  TitanNodeStatus,
  | "node"
  | "nodeId"
  | "displayName"
  | "registryDroplet"
  | "host"
  | "port"
  | "displayUrl"
  | "healthy"
  | "peers"
  | "chainId"
  | "blockNumber"
  | "error"
  | "discoveryMethod"
  | "inMesh"
>;

interface TitanRuntimeConfig {
  rpcUrl: string;
  dashboardUrl: string;
  explorerUrl: string;
  networkName: string;
  networkId?: number;
}

function StatCard({ title, value, sub, ok }: { title: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {ok !== undefined && (ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-red-500" />)}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function NetworkOverview() {
  const [nodes, setNodes] = useState<NodeHealth[]>([]);
  const [meshPeerCount, setMeshPeerCount] = useState<number | null>(null);
  const [rpcProbeNode, setRpcProbeNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [copiedField, setCopiedField] = useState<string>("");
  const [runtime, setRuntime] = useState<TitanRuntimeConfig | null>(null);
  const address = useWalletStore((s) => s.address);
  const walletChainId = useWalletStore((s) => s.chainId);
  const titanBalance = useWalletStore((s) => s.titanBalance);
  const signMessage = useWalletStore((s) => s.signMessage);
  const walletError = useWalletStore((s) => s.error);
  const walletLoading = useWalletStore((s) => s.isLoading);
  const connectWallet = useWalletStore((s) => s.connect);
  const isWalletConnectedNow = isWalletConnected({ address });
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState<number | null>(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch("/api/titan/rpc");
      const data = await res.json();
      setNodes(data.nodes ?? []);
      setMeshPeerCount(typeof data.meshPeerCount === "number" ? data.meshPeerCount : null);
      setRpcProbeNode(typeof data.rpcProbeNode === "string" ? data.rpcProbeNode : null);
      setLastUpdated(new Date());
    } catch { setNodes([]); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchAll();
    fetch("/api/titan/config")
      .then((r) => r.json())
      .then((j) =>
        setRuntime({
          rpcUrl: j.rpcUrl ?? APP_CONFIG.titan.rpcUrl,
          dashboardUrl: j.dashboardUrl ?? APP_CONFIG.titan.dashboardUrl,
          explorerUrl: j.explorerUrl ?? APP_CONFIG.titan.explorerUrl,
          networkName: j.networkName ?? APP_CONFIG.titan.networkName,
          networkId: j.networkId ?? APP_CONFIG.titan.networkId,
        }),
      )
      .catch(() => setRuntime(null));
    const id = setInterval(fetchAll, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lastUpdated) {
      setSecondsSinceRefresh(null);
      return;
    }
    const tick = () =>
      setSecondsSinceRefresh(Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const bootstrap = nodes.find((n) => n.discoveryMethod === "bootstrap");
  const meshValidators = nodes.filter((n) => n.inMesh || n.discoveryMethod === "bootstrap").length;
  const healthyCount = nodes.filter((n) => n.healthy).length;
  const chainId = bootstrap?.chainId ?? nodes.find((n) => n.chainId)?.chainId ?? "—";
  const blockNumber = bootstrap?.blockNumber ?? nodes.find((n) => n.blockNumber)?.blockNumber ?? "—";
  const meshPeers =
    (typeof meshPeerCount === "number" && Number.isFinite(meshPeerCount)
      ? meshPeerCount
      : null) ??
    (typeof bootstrap?.peers === "number" ? bootstrap.peers : null) ??
    4;

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(""), 1500);
    } catch {
      setCopiedField("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Titan Network</h1>
          <p className="text-sm text-muted-foreground">
            {runtime?.networkName ?? APP_CONFIG.titan.networkName} · Chain ID {chainId} · Network ID{" "}
            {runtime?.networkId ?? APP_CONFIG.titan.networkId}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isWalletConnectedNow ? (
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
                <Wallet className="size-4" />
              </div>
              <div className="text-right text-sm leading-tight">
                <p className="font-mono font-medium">{shortAddress(address)}</p>
                <p className="text-xs text-muted-foreground">
                  {titanBalance} {APP_CONFIG.titan.nativeToken.symbol}
                </p>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void connectWallet()}
              disabled={walletLoading}
              className="gap-2"
            >
              {walletLoading ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              Connect wallet
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => void fetchAll()}
              disabled={loading}
              className="underline-offset-2 hover:underline disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {secondsSinceRefresh != null && (
              <>
                {" · "}
                Updated {secondsSinceRefresh === 0 ? "just now" : `${secondsSinceRefresh}s ago`}
                {" · auto every 10s"}
              </>
            )}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Validators in mesh"
          value={String(meshValidators || nodes.length)}
          sub={rpcProbeNode ? `via ${rpcProbeNode} RPC` : "P2P gossip + RPC"}
          ok={meshValidators >= 5 || nodes.length >= 5}
        />
        <StatCard title="Chain ID" value={chainId} sub="C-Chain" />
        <StatCard title="Latest Block" value={blockNumber} sub="Network head (shared)" />
        <StatCard
          title="Mesh peers"
          value={String(meshPeers)}
          sub="Other validators connected to RPC node"
          ok={meshPeers >= 4}
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
                  <Badge className="shrink-0 bg-green-600 text-[10px]">Direct API</Badge>
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
              {info.nodeId && info.displayName && (
                <p className="text-[10px] text-muted-foreground font-mono truncate" title={info.nodeId}>
                  {info.nodeId}
                </p>
              )}
            </CardHeader>
            <CardContent className="text-sm space-y-1">
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
                <span className="font-medium font-mono">
                  {info.blockNumber ?? "—"}
                  {info.discoveryMethod === "p2p-gossip" && info.blockNumber ? (
                    <span className="text-[10px] text-muted-foreground font-sans ml-1">(shared)</span>
                  ) : null}
                </span>
              </div>
              {info.error && <p className="text-xs text-red-500 break-all">{info.error}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Developer Connection</CardTitle>
            <Badge variant="secondary">MetaMask Ready</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {isWalletConnectedNow
              ? "Your wallet is connected. Use these values to configure MetaMask or other Titan tooling."
              : "Use these values to add Titan to MetaMask. Connect your wallet above."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3 text-sm">
              <p className="text-xs uppercase text-muted-foreground">Dashboard URL</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono break-all">{runtime?.dashboardUrl ?? APP_CONFIG.titan.dashboardUrl}</p>
                <Button size="icon" variant="ghost" onClick={() => copyValue("dashboard", runtime?.dashboardUrl ?? APP_CONFIG.titan.dashboardUrl)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="text-xs uppercase text-muted-foreground">RPC URL</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono break-all">{runtime?.rpcUrl ?? APP_CONFIG.titan.rpcUrl}</p>
                <Button size="icon" variant="ghost" onClick={() => copyValue("rpc", runtime?.rpcUrl ?? APP_CONFIG.titan.rpcUrl)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="text-xs uppercase text-muted-foreground">Chain / Network</p>
              <p className="mt-1 font-mono">
                {APP_CONFIG.titan.chainIdDec} ({APP_CONFIG.titan.chainIdHex}) / {APP_CONFIG.titan.networkId}
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="text-xs uppercase text-muted-foreground">Explorer URL</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono break-all">{runtime?.explorerUrl ?? APP_CONFIG.titan.explorerUrl}</p>
                <Button size="icon" variant="ghost" onClick={() => copyValue("explorer", runtime?.explorerUrl ?? APP_CONFIG.titan.explorerUrl)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-md border p-3 text-sm sm:col-span-2">
              <p className="text-xs uppercase text-muted-foreground">Native Token</p>
              <p className="mt-1 font-mono">
                {APP_CONFIG.titan.nativeToken.name} ({APP_CONFIG.titan.nativeToken.symbol}) · {APP_CONFIG.titan.nativeToken.decimals} decimals
              </p>
            </div>
          </div>

          {copiedField && <p className="text-xs text-muted-foreground">Copied {copiedField} to clipboard.</p>}
          {isWalletConnectedNow && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
              <p className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <Wallet className="h-4 w-4" />
                Wallet connected
              </p>
              <p>
                <span className="text-muted-foreground">Address:</span>{" "}
                <span className="font-mono">{shortAddress(address)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Balance:</span>{" "}
                <span className="font-mono">
                  {titanBalance} {APP_CONFIG.titan.nativeToken.symbol}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Network:</span>{" "}
                {isOnTitanChain(walletChainId) ? APP_CONFIG.titan.networkName : `Chain ${walletChainId}`}
              </p>
              {signMessage && (
                <p className="text-emerald-600 flex items-center gap-1 pt-1">
                  <ShieldCheck className="h-4 w-4" /> {signMessage}
                </p>
              )}
            </div>
          )}
          {walletError && !isWalletConnectedNow && <p className="text-sm text-red-500 break-all">{walletError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
