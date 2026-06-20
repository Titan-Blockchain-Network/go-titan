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
import { issueAtomicTx } from "@/lib/titan/staking-client";
import {
  isOnTitanChainId,
  isStakingNetworkReady,
  walletKindLabel,
} from "@/lib/titan/wallet-providers";
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
  pendingImportUtxos?: number;
  derivedPAddress: string | null;
}

export function StakingHub() {
  const address = useWalletStore((s) => s.address);
  const chainId = useWalletStore((s) => s.chainId);
  const walletKind = useWalletStore((s) => s.walletKind);
  const coreInstalled = useWalletStore((s) => s.coreInstalled);
  const coreAddress = useWalletStore((s) => s.coreAddress);
  const cBalance = useWalletStore((s) => s.titanBalance);
  const connect = useWalletStore((s) => s.connect);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);
  const addTitanToActiveWallet = useWalletStore((s) => s.addTitanToActiveWallet);
  const walletConnectError = useWalletStore((s) => s.error);
  const networkWarning = useWalletStore((s) => s.networkWarning);
  const walletIsLoading = useWalletStore((s) => s.isLoading);

  const walletReady = isWalletConnected({ address });
  const onTitan = isOnTitanChain(chainId);
  const stakingReady = isStakingNetworkReady(chainId, walletKind);
  const coreReady =
    coreInstalled &&
    walletReady &&
    (walletKind === "core" ||
      Boolean(coreAddress && coreAddress.toLowerCase() === address.toLowerCase()));

  const [data, setData] = useState<StakingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [transferStatus, setTransferStatus] = useState("");

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

  async function runTransfer(step: "export" | "import") {
    setTransferStatus("");
    if (!walletReady) {
      setTransferStatus("Connect a wallet first (sidebar or below).");
      return;
    }
    if (!stakingReady) {
      setTransferStatus(
        walletKind === "core"
          ? "Connect Core first, then click “Add Titan to Core” if Core is not on chain 888."
          : "Switch your wallet to Titan network (chain 888), then try again.",
      );
      return;
    }
    if (!coreReady) {
      setTransferStatus(
        coreInstalled
          ? coreAddress
            ? `Core is on ${shortAddress(coreAddress)} but C-chain is ${shortAddress(address)} — use the same account in both, or connect Core from the sidebar.`
            : "Unlock Avalanche Core and authorize this site (sidebar → Connect wallet → Core)."
          : "Install Avalanche Core (core.app) — export/import/delegate sign in Core.",
      );
      return;
    }
    if (step === "import" && (data?.pendingImportUtxos ?? 0) === 0) {
      setTransferStatus(
        "Nothing to import yet. Run Export first, wait ~30 seconds, then click Import again.",
      );
      return;
    }

    setBusy(step);
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

      setTransferStatus(
        step === "export"
          ? "Check the Core extension icon in your browser toolbar — approve the C-chain export there…"
          : "Check the Core extension icon — approve the P-chain import there…",
      );

      const txId = await issueAtomicTx(txHex, chain);
      const message =
        step === "export"
          ? `Export submitted (${txId.slice(0, 12)}…). Wait ~30s until “ready to import” shows, then click Import.`
          : `Import submitted (${txId.slice(0, 12)}…). P-chain balance should update shortly.`;
      setTransferStatus(message);
      setStatus(message);
      await refreshBalance();
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transfer failed";
      setTransferStatus(message);
      setStatus(message);
    } finally {
      setBusy("");
    }
  }

  async function runDelegate() {
    if (!walletReady || !stakingReady || !coreReady || !selectedNode) return;
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

      {walletReady && !isOnTitanChainId(chainId) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm space-y-3">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {walletKind === "core" ? "Add Titan to Core" : "Switch to Titan network"}
            </p>
            <p className="text-muted-foreground">
              {walletKind === "core"
                ? "Core has no manual “custom network” screen like MetaMask. Use the button below — Core will show an Add Network prompt for Titan (chain 888, RPC rpc.titan-network.xyz)."
                : "Your wallet is on the wrong network. Approve the Titan network switch to fund P-chain and delegate."}
            </p>
            {walletKind === "core" && (
              <Button size="sm" variant="outline" onClick={() => void addTitanToActiveWallet()} disabled={walletIsLoading}>
                {walletIsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Add Titan to Core (chain 888)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {networkWarning && (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-amber-900 dark:text-amber-200">
          {networkWarning}
        </p>
      )}

      {walletConnectError && (
        <p className="text-sm rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
          {walletConnectError}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Wallet status</CardTitle>
          <CardDescription>
            C-chain connect via sidebar or below. P-chain export/import/delegate always sign in Core.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">C-chain (balance + address)</p>
            <p className="font-medium mt-0.5">
              {walletReady ? (
                <>
                  {walletKindLabel(walletKind)} · {shortAddress(address)}
                  {onTitan ? (
                    <Badge className="ml-2 bg-green-600">Titan 888</Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2">
                      wrong network
                    </Badge>
                  )}
                </>
              ) : (
                "Not connected"
              )}
            </p>
          </div>
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">Core (P-chain signing)</p>
            <p className="font-medium mt-0.5">
              {!coreInstalled && "Extension not detected"}
              {coreInstalled && !coreAddress && walletKind !== "core" && "Installed — unlock & authorize"}
              {coreInstalled && walletKind === "core" && walletReady && (
                <>
                  Connected · {shortAddress(address)}
                  <Badge className="ml-2 bg-green-600">signing wallet</Badge>
                </>
              )}
              {coreInstalled && coreAddress && coreReady && walletKind !== "core" && (
                <>
                  Ready · {shortAddress(coreAddress)}
                  <Badge className="ml-2 bg-green-600">matched</Badge>
                </>
              )}
              {coreInstalled && coreAddress && !coreReady && walletKind !== "core" && (
                <>
                  {shortAddress(coreAddress)}
                  <Badge variant="outline" className="ml-2">
                    different from C-chain
                  </Badge>
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {walletReady && onTitan && !coreReady && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">Core required for P-chain steps</p>
            <p className="mt-1 text-muted-foreground">
              {walletKind === "core"
                ? "You're connected via Core for C-chain — unlock Core if P-chain signing still fails."
                : "Connect Core from the sidebar (same address as MetaMask) or install"}{" "}
              {walletKind !== "core" && (
                <a
                  href="https://core.app"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Avalanche Core <ExternalLink className="h-3 w-3" />
                </a>
              )}
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
              Cross-chain transfer is two atomic transactions. Export locks TITAN on C-chain; import
              releases it on P-chain. Both steps sign in <strong>Core</strong> — MetaMask only shows
              your C-chain balance here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!walletReady ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void connect("core")}
                    disabled={walletIsLoading || !coreInstalled}
                    className="w-full sm:w-auto"
                  >
                    {walletIsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                    Connect Core (recommended)
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void connect("metamask")}
                    disabled={walletIsLoading}
                    className="w-full sm:w-auto"
                  >
                    Connect MetaMask
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Core opens a site-access prompt in the extension toolbar (not a page popup). Approve
                  there, then approve Add Network for Titan if asked.
                </p>
              </div>
            ) : (
              <>
                {data?.derivedPAddress && (
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    P-address: {data.derivedPAddress}
                  </p>
                )}
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>
                    <strong>Export</strong> — Core popup approves moving TITAN off C-chain (small fee
                    ~0.01 T).
                  </li>
                  <li>
                    <strong>Wait ~30s</strong> — network accepts the export and queues funds for import
                    {typeof data?.pendingImportUtxos === "number" && data.pendingImportUtxos > 0
                      ? ` (${data.pendingImportUtxos} batch${data.pendingImportUtxos === 1 ? "" : "es"} ready)`
                      : ""}
                    .
                  </li>
                  <li>
                    <strong>Import</strong> — Core popup pulls those funds onto P-chain at the address
                    above.
                  </li>
                </ol>
                {typeof data?.pendingImportUtxos === "number" && data.pendingImportUtxos > 0 && (
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">
                    Ready to import — {data.pendingImportUtxos} export
                    {data.pendingImportUtxos === 1 ? "" : "s"} waiting on P-chain.
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
                    disabled={!stakingReady || !coreReady || busy !== ""}
                  >
                    {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    1. Export to P-chain
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runTransfer("import")}
                    disabled={!stakingReady || !coreReady || busy !== ""}
                  >
                    {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    2. Import on P-chain
                  </Button>
                </div>
                {transferStatus && (
                  <p className="text-sm rounded-md border bg-muted/40 px-3 py-2 break-words">
                    {transferStatus}
                  </p>
                )}
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
              disabled={!walletReady || !stakingReady || !coreReady || busy !== "" || needsTransfer}
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