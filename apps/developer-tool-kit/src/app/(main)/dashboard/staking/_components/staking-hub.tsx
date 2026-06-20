"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  Wallet,
} from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shortAddress } from "@/lib/titan/format";
import {
  hasAvalancheWallet,
  issueAtomicTx,
  listenForAvalancheWallet,
} from "@/lib/titan/staking-client";
import { isOnTitanChain, isWalletConnected, useWalletStore } from "@/stores/wallet/wallet-store";

interface ValidatorRow {
  nodeID: string;
  displayName: string;
  stakeTitan: number;
  uptimePercent: number | null;
  connected: boolean | null;
  delegationFeePercent: number | null;
  potentialRewardTitan: number;
}

interface StakingSnapshot {
  hrp: string;
  minValidatorStakeTitan: number;
  minDelegatorStakeTitan: number;
  minDelegationDays: number;
  maxDelegationDays: number;
  validatorCount: number;
  validators: ValidatorRow[];
  wallet: {
    pAddress: string;
    balanceTitan: number;
  } | null;
  walletError?: string;
  derivedPAddress: string | null;
}

export function StakingHub() {
  const address = useWalletStore((s) => s.address);
  const chainId = useWalletStore((s) => s.chainId);
  const cBalance = useWalletStore((s) => s.titanBalance);
  const connect = useWalletStore((s) => s.connect);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);

  const walletReady = isWalletConnected({ address });
  const onTitan = isOnTitanChain(chainId);

  const [data, setData] = useState<StakingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [coreDetected, setCoreDetected] = useState(false);

  const [transferAmount, setTransferAmount] = useState("1");
  const [delegateAmount, setDelegateAmount] = useState("1");
  const [delegateDays, setDelegateDays] = useState("30");
  const [selectedNode, setSelectedNode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = walletReady ? `?cAddress=${encodeURIComponent(address)}` : "";
      const res = await fetch(`/api/titan/staking${qs}`);
      const json = (await res.json()) as StakingSnapshot & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(json.walletError ?? "");
      if (!selectedNode && json.validators[0]?.nodeID) {
        setSelectedNode(json.validators[0].nodeID);
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load staking data");
    } finally {
      setLoading(false);
    }
  }, [address, walletReady]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshCore = () => setCoreDetected(hasAvalancheWallet());
    refreshCore();
    const stop = listenForAvalancheWallet();
    const timer = window.setInterval(refreshCore, 2000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, []);

  async function runTransfer(step: "export" | "import") {
    if (!walletReady || !onTitan) return;
    setBusy(step);
    setStatus("");
    try {
      const res = await fetch("/api/titan/staking/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cAddress: address,
          amountTitan: step === "export" ? Number(transferAmount) : undefined,
          step,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        exportTxHex?: string;
        importTxHex?: string;
        exportChain?: "C";
        importChain?: "P";
      };
      if (!res.ok) throw new Error(json.error ?? "Transfer build failed");

      const txHex = step === "export" ? json.exportTxHex : json.importTxHex;
      const chain = step === "export" ? json.exportChain : json.importChain;
      if (!txHex || !chain) throw new Error("Missing transaction bytes");

      const txId = await issueAtomicTx(txHex, chain);
      setStatus(
        step === "export"
          ? `Export submitted (${txId.slice(0, 12)}…). Wait ~30s, then run Import on P-chain.`
          : `Import submitted (${txId.slice(0, 12)}…). P-chain balance should update shortly.`,
      );
      await refreshBalance();
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy("");
    }
  }

  async function runDelegate() {
    if (!walletReady || !onTitan || !selectedNode) return;
    setBusy("delegate");
    setStatus("");
    try {
      const res = await fetch("/api/titan/staking/delegate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cAddress: address,
          nodeId: selectedNode,
          amountTitan: Number(delegateAmount),
          days: Number(delegateDays),
        }),
      });
      const json = (await res.json()) as { error?: string; delegateTxHex?: string; chain?: "P" };
      if (!res.ok) throw new Error(json.error ?? "Delegate build failed");
      if (!json.delegateTxHex || !json.chain) throw new Error("Missing delegate transaction");

      const txId = await issueAtomicTx(json.delegateTxHex, json.chain);
      setStatus(`Delegation submitted (${txId.slice(0, 12)}…). Rewards unlock when the period ends.`);
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Delegation failed");
    } finally {
      setBusy("");
    }
  }

  const pBalance = data?.wallet?.balanceTitan ?? 0;
  const needsTransfer = walletReady && pBalance < Number(delegateAmount || 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            Staking
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Delegate {APP_CONFIG.titan.nativeToken.symbol} to Titan validators on the P-chain. Your
            MetaMask address maps to a matching P-chain wallet — fund it via cross-chain transfer,
            then stake without running a node.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {walletReady && !onTitan && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">Switch to Titan network</p>
            <p className="mt-1 text-muted-foreground">
              C-chain is connected, but your wallet is on the wrong network. Approve the Titan network
              switch in MetaMask to fund P-chain and delegate.
            </p>
          </CardContent>
        </Card>
      )}

      {walletReady && onTitan && !coreDetected && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">Avalanche Core required for P-chain</p>
            <p className="mt-1 text-muted-foreground">
              MetaMask covers C-chain balances and export signing. Import and delegation need{" "}
              <a
                href="https://core.app"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Avalanche Core <ExternalLink className="h-3 w-3" />
              </a>{" "}
              on the same address — unlock Core on this page, then retry export / import / delegate.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniStat title="Validators" value={data ? String(data.validatorCount) : "—"} />
        <MiniStat
          title="Min delegate"
          value={data ? `${data.minDelegatorStakeTitan} T` : "—"}
          sub="network minimum"
        />
        <MiniStat title="C-chain balance" value={walletReady ? `${cBalance} T` : "—"} />
        <MiniStat
          title="P-chain balance"
          value={walletReady && data?.wallet ? `${pBalance.toLocaleString()} T` : "—"}
          sub={
            data?.wallet
              ? shortAddress(data.wallet.pAddress)
              : walletReady
                ? data?.derivedPAddress
                  ? shortAddress(data.derivedPAddress)
                  : error || "Loading P-chain…"
                : "Connect wallet"
          }
          mono
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Fund P-chain (C → P)
            </CardTitle>
            <CardDescription>
              Step 1: export from C-chain. Step 2: after ~30 seconds, import on P-chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!walletReady ? (
              <Button onClick={() => void connect()} className="w-full sm:w-auto">
                <Wallet className="h-4 w-4" />
                Connect wallet
              </Button>
            ) : (
              <>
                {data?.derivedPAddress && (
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    P-address: {data.derivedPAddress}
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-amt">Amount ({APP_CONFIG.titan.nativeToken.symbol})</Label>
                  <Input
                    id="transfer-amt"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    inputMode="decimal"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void runTransfer("export")}
                    disabled={!onTitan || busy !== ""}
                  >
                    {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    1. Export to P-chain
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runTransfer("import")}
                    disabled={!onTitan || busy !== ""}
                  >
                    {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    2. Import on P-chain
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Delegate to validator
            </CardTitle>
            <CardDescription>
              Locks P-chain {APP_CONFIG.titan.nativeToken.symbol} to a validator for the chosen period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="validator">Validator</Label>
              <select
                id="validator"
                value={selectedNode}
                onChange={(e) => setSelectedNode(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(data?.validators ?? []).map((v) => (
                  <option key={v.nodeID} value={v.nodeID}>
                    {v.displayName} · {v.stakeTitan.toLocaleString()} T staked
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="delegate-amt">Stake amount</Label>
                <Input
                  id="delegate-amt"
                  value={delegateAmount}
                  onChange={(e) => setDelegateAmount(e.target.value)}
                  inputMode="decimal"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delegate-days">Days (min {data?.minDelegationDays ?? 1})</Label>
                <Input
                  id="delegate-days"
                  value={delegateDays}
                  onChange={(e) => setDelegateDays(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
            </div>
            {needsTransfer && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                P-chain balance is lower than the stake amount — fund P-chain first.
              </p>
            )}
            <Button
              onClick={() => void runDelegate()}
              disabled={!walletReady || !onTitan || busy !== "" || needsTransfer}
              className="w-full sm:w-auto"
            >
              {busy === "delegate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Delegate stake
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validator set</CardTitle>
          <CardDescription>Live data from platform.getCurrentValidators</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading validators…
            </div>
          ) : error && !data ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : error && data ? (
            <p className="text-sm text-amber-700 dark:text-amber-400 py-2 mb-2">{error}</p>
          ) : null}
          {data ? (
            <div className="divide-y rounded-lg border">
              {(data?.validators ?? []).map((v) => (
                <div
                  key={v.nodeID}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-semibold text-sm">{v.displayName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate max-w-md">
                      {v.nodeID}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">{v.stakeTitan.toLocaleString()} T</Badge>
                    {v.delegationFeePercent != null && (
                      <span className="text-muted-foreground">Fee {v.delegationFeePercent}%</span>
                    )}
                    {v.uptimePercent != null && (
                      <span className="text-muted-foreground">{v.uptimePercent.toFixed(1)}% uptime</span>
                    )}
                    {v.connected ? (
                      <Badge className="bg-green-600">Online</Badge>
                    ) : (
                      <Badge variant="outline">Offline</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {status && (
        <p className="text-sm rounded-md border bg-muted/30 px-4 py-3 break-words">{status}</p>
      )}
    </div>
  );
}

function MiniStat({
  title,
  value,
  sub,
  mono,
}: {
  title: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-lg font-semibold tabular-nums ${mono ? "font-mono text-sm" : ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}