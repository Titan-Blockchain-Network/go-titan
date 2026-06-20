"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  Blocks,
  CheckCircle2,
  ChevronRight,
  Code2,
  ExternalLink,
  Gamepad2,
  GitBranch,
  Loader2,
  Radio,
  RefreshCw,
  Rocket,
  Server,
  Swords,
  Wallet,
} from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { shortAddress } from "@/lib/titan/format";
import { useTitanConfig } from "@/lib/titan/use-titan-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_MS = 15_000;

interface BlockSummary {
  number: string;
  hash: string;
  timestamp: string;
  txCount: number;
  gasUsed: string;
}

interface ChessMatch {
  kind: "started" | "resolved";
  gameId: string;
  player?: string;
  stake?: string;
  outcome?: string;
  winner?: string;
  blockNumber: string;
  txHash: string;
}

interface ChessEscrowSnapshot {
  address: string;
  queueLength: number;
  activeGames: number;
  houseBankroll: string;
  nextGameId: number;
  minStake: string;
  maxStake: string;
  recentMatches: ChessMatch[];
}

interface NetworkMeshSnapshot {
  blockNumber: string;
  chainId: string | null;
  validatorsInMesh: number;
  meshPeerCount: number | null;
  rpcProbeNode: string | null;
  healthy: boolean;
  nodes: Array<{
    name: string;
    registryId?: string;
    blockNumber: string;
    healthy: boolean;
    role: string;
  }>;
}

interface EcosystemSnapshot {
  ok: boolean;
  fetchedAt: number;
  network: NetworkMeshSnapshot;
  recentBlocks: BlockSummary[];
  chessEscrow: ChessEscrowSnapshot | null;
  apps: {
    chessUrl: string | null;
    chessEscrowConfigured: boolean;
    chessEscrowAddress: string | null;
  };
  docsRepoUrl: string;
  error?: string;
}

function PulseDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex size-2.5">
      <span
        className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <span
        className={`relative inline-flex size-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub?: string;
  ok?: boolean;
}) {
  return (
    <Card className="bg-linear-to-t from-primary/5 to-card shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {ok !== undefined &&
          (ok ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <Activity className="size-4 text-amber-500" />
          ))}
      </CardHeader>
      <CardContent>
        <div className="font-semibold text-2xl tabular-nums tracking-tight">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function AppCard({
  title,
  description,
  href,
  icon: Icon,
  external,
  badge,
  stats,
}: {
  title: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
  badge?: string;
  stats?: string;
}) {
  const inner = (
    <Card className="group h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="flex items-center gap-2">
            {badge && (
              <Badge variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            )}
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="line-clamp-2">{description}</CardDescription>
      </CardHeader>
      {stats && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{stats}</p>
        </CardContent>
      )}
    </Card>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  );
}

function formatBlockTime(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - n);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(n * 1000).toLocaleTimeString();
}

export function EcosystemHub() {
  const titan = useTitanConfig();
  const [data, setData] = useState<EcosystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await fetch("/api/titan/ecosystem", { cache: "no-store" });
      const json = (await res.json()) as EcosystemSnapshot;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to load ecosystem snapshot");
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
    const id = setInterval(() => void fetchSnapshot(true), POLL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  const network = data?.network;
  const chess = data?.chessEscrow;
  const operational = network?.healthy && Number(network?.blockNumber) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl border bg-primary/10 text-primary">
              <Rocket className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Ecosystem Launchpad</h1>
              <p className="text-sm text-muted-foreground">
                Live apps, on-chain activity, and builder tools on {titan.networkName}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={operational ? "default" : "outline"} className="gap-1.5">
              <PulseDot ok={Boolean(operational)} />
              {operational ? "Network operational" : "Checking network"}
            </Badge>
            <Badge variant="outline">Chain {titan.chainIdDec}</Badge>
            {data?.fetchedAt && (
              <span className="text-xs text-muted-foreground">
                Updated {Math.max(0, Math.floor((Date.now() - data.fetchedAt) / 1000))}s ago
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void fetchSnapshot(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href="/api/titan/status" target="_blank" rel="noopener noreferrer">
              <Radio className="size-4" />
              Status API
              <ExternalLink className="size-3 opacity-60" />
            </a>
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 w-24 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 rounded bg-muted" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatTile
              label="Block height"
              value={network?.blockNumber ?? "—"}
              sub={network?.rpcProbeNode ? `via ${network.rpcProbeNode}` : undefined}
              ok={Number(network?.blockNumber) > 0}
            />
            <StatTile
              label="Validators"
              value={String(network?.validatorsInMesh ?? "—")}
              sub="Registered in mesh"
              ok={(network?.validatorsInMesh ?? 0) > 0}
            />
            <StatTile
              label="Mesh peers"
              value={network?.meshPeerCount != null ? String(network.meshPeerCount) : "—"}
              sub="P2P connections"
              ok={(network?.meshPeerCount ?? 0) > 0}
            />
            <StatTile
              label="Chess escrow"
              value={
                chess
                  ? `${chess.activeGames} live`
                  : data?.apps.chessEscrowConfigured
                    ? "—"
                    : "Not set"
              }
              sub={
                chess
                  ? `${chess.queueLength} queued · ${chess.houseBankroll} T pool`
                  : "Set TITAN_CHESS_ESCROW_ADDRESS"
              }
              ok={Boolean(chess && Number(chess.houseBankroll) > 0)}
            />
          </>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Live apps</h2>
          <span className="text-xs text-muted-foreground">Shipped on Titan mainnet</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AppCard
            title="Titan Chess"
            description="Practice Stockfish or wager TITAN against the house. Escrow-backed matches with on-chain settlement."
            href={data?.apps.chessUrl ?? "/dashboard/ecosystem"}
            icon={Gamepad2}
            external={Boolean(data?.apps.chessUrl)}
            badge={data?.apps.chessUrl ? "Live" : "Configure URL"}
            stats={
              chess
                ? `Game #${chess.nextGameId} · stakes ${chess.minStake}–${chess.maxStake} T`
                : undefined
            }
          />
          <AppCard
            title="Contract Studio"
            description="Compile, deploy, and interact with Solidity on the C-Chain. Includes Titan Chess escrow template."
            href="/dashboard/contracts"
            icon={Code2}
            badge="Builder"
          />
          <AppCard
            title="Chain Explorer"
            description="Browse blocks, transactions, validators, and chain analytics in real time."
            href="/dashboard/activity"
            icon={Blocks}
            badge="Core"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4 text-primary" />
              Chess escrow monitor
            </CardTitle>
            <CardDescription>
              On-chain match queue and recent activity
              {data?.apps.chessEscrowAddress && (
                <span className="ml-1 font-mono text-xs">
                  · {shortAddress(data.apps.chessEscrowAddress)}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data?.apps.chessEscrowConfigured ? (
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                <p>Set <code className="text-xs">TITAN_CHESS_ESCROW_ADDRESS</code> on Explorer to watch live matches.</p>
              </div>
            ) : !chess ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading escrow state…
              </div>
            ) : chess.recentMatches.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No recent matches in the log window. Deposit house bankroll and queue a wager to see activity here.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {chess.recentMatches.map((m) => (
                  <div
                    key={`${m.kind}-${m.gameId}-${m.txHash}`}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={m.kind === "started" ? "secondary" : "outline"}>
                        {m.kind === "started" ? "Started" : "Resolved"}
                      </Badge>
                      <span className="font-medium text-sm">Game #{m.gameId}</span>
                      {m.stake && (
                        <span className="text-xs text-muted-foreground">{m.stake} T stake</span>
                      )}
                      {m.outcome && (
                        <span className="text-xs text-muted-foreground">{m.outcome}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {m.player && <span className="font-mono">{shortAddress(m.player)}</span>}
                      {m.winner && m.kind === "resolved" && (
                        <span>→ {shortAddress(m.winner)}</span>
                      )}
                      <span>blk {m.blockNumber}</span>
                      <Link
                        href={`/dashboard/activity?tx=${m.txHash}`}
                        className="text-primary hover:underline"
                      >
                        tx
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Blocks className="size-4 text-primary" />
              Recent blocks
            </CardTitle>
            <CardDescription>Latest C-Chain activity</CardDescription>
          </CardHeader>
          <CardContent>
            {!data?.recentBlocks?.length ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Loading blocks…
                  </>
                ) : (
                  "No blocks available"
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {data.recentBlocks.map((b) => (
                  <Link
                    key={b.hash}
                    href={`/dashboard/activity?block=${b.number}`}
                    className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
                  >
                    <div>
                      <span className="font-medium tabular-nums">#{b.number}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {b.txCount} tx · {formatBlockTime(b.timestamp)}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortAddress(b.hash, 8, 6)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Builder quick-start</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Connect wallet",
              desc: `Add ${titan.networkName} (chain ${titan.chainIdDec}) in MetaMask`,
              icon: Wallet,
              href: "/dashboard/default",
            },
            {
              title: "Deploy contract",
              desc: "Use Contract Studio with built-in Titan templates",
              icon: Code2,
              href: "/dashboard/contracts",
            },
            {
              title: "Run a node",
              desc: "Join the validator mesh and expose RPC",
              icon: Server,
              href: "/dashboard/nodes",
            },
            {
              title: "Fork the repo",
              desc: "Docs, chess app, and explorer source",
              icon: GitBranch,
              href: data?.docsRepoUrl ?? "https://github.com/Titan-Blockchain-Network/go-titan",
              external: true,
            },
          ].map((item) => {
            const Icon = item.icon;
            const content = (
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div className="flex size-9 items-center justify-center rounded-lg border bg-muted/50">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );

            if (item.external) {
              return (
                <a
                  key={item.title}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  {content}
                </a>
              );
            }

            return (
              <Link key={item.title} href={item.href} className="block">
                {content}
              </Link>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Native token: {APP_CONFIG.titan.nativeToken.symbol} · Public RPC:{" "}
          <code className="text-[11px]">{titan.rpcUrl}</code>
        </p>
      </section>
    </div>
  );
}