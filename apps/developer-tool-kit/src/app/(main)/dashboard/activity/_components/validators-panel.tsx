"use client";

import { useCallback, useEffect, useState } from "react";

import { CheckCircle2, Clock, Loader2, RefreshCw, Shield, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ValidatorRow {
  nodeID: string;
  displayName?: string;
  registryId?: string;
  registryRole?: string;
  registryDroplet?: string;
  stakeTitan: number;
  startTime: number | null;
  endTime: number | null;
  uptimePercent: number | null;
  connected: boolean | null;
  delegationFeePercent: number | null;
  potentialRewardTitan: number;
  rewardAddresses: string[];
}

interface PendingRow {
  nodeID: string;
  displayName?: string;
  stakeTitan: number;
  startTime: number | null;
  endTime: number | null;
}

interface ValidatorsResponse {
  validatorCount: number;
  pendingCount: number;
  totalStakedTitan: number;
  pChainHeight: number | null;
  networkId: number | null;
  nodeVersion: string | null;
  bootstrapped: Record<string, boolean>;
  validators: ValidatorRow[];
  pendingValidators: PendingRow[];
  addressLabels: Record<string, string>;
  errors?: string[];
}

function shortNodeId(nodeID: string): string {
  return nodeID.replace(/^NodeID-/, "").slice(0, 16);
}

function validatorLabel(v: { displayName?: string; nodeID: string }): string {
  return v.displayName?.trim() || shortNodeId(v.nodeID);
}

function formatUnix(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleString();
}

interface ValidatorsPanelProps {
  onLabelsLoaded?: (labels: Record<string, string>) => void;
}

export function ValidatorsPanel({ onLabelsLoaded }: ValidatorsPanelProps) {
  const [data, setData] = useState<ValidatorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/titan/validators");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as ValidatorsResponse;
      setData(j);
      onLabelsLoaded?.(j.addressLabels ?? {});
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load validators");
    } finally {
      setLoading(false);
    }
  }, [onLabelsLoaded]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading validator set from P-chain…
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-8 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Validator set
          </h2>
          <p className="text-sm text-muted-foreground">
            Live staking data from <code className="font-mono text-xs">platform.getCurrentValidators</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat title="Validators" value={String(data.validatorCount)} />
        <MiniStat title="Total staked" value={`${data.totalStakedTitan.toLocaleString()} TITAN`} />
        <MiniStat title="P-chain height" value={data.pChainHeight?.toLocaleString() ?? "—"} />
        <MiniStat
          title="Chains synced"
          value={["C", "P", "X"]
            .map((c) => `${c}:${data.bootstrapped[c] ? "✓" : "…"}`)
            .join(" ")}
        />
      </div>

      {data.nodeVersion && (
        <p className="text-xs text-muted-foreground font-mono">Node software: {data.nodeVersion}</p>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider border-b">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Validator</th>
              <th className="px-4 py-2.5 text-right font-medium">Stake</th>
              <th className="px-4 py-2.5 text-right font-medium hidden md:table-cell">Uptime</th>
              <th className="px-4 py-2.5 text-center font-medium w-24">Status</th>
              <th className="px-4 py-2.5 text-left font-medium hidden lg:table-cell">Active until</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.validators.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No active validators returned yet.
                </td>
              </tr>
            ) : (
              data.validators.map((v) => (
                <tr key={v.nodeID} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5" title={v.nodeID}>
                    <div className="font-semibold">{validatorLabel(v)}</div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[220px]">
                      {v.registryDroplet ? `${v.registryDroplet} · ` : ""}
                      {shortNodeId(v.nodeID)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {v.stakeTitan.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums hidden md:table-cell">
                    {v.uptimePercent != null ? `${v.uptimePercent.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {v.connected === true ? (
                      <Badge className="bg-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Online
                      </Badge>
                    ) : v.connected === false ? (
                      <Badge variant="secondary" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Offline
                      </Badge>
                    ) : (
                      <Badge variant="outline">—</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                    {formatUnix(v.endTime)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.pendingValidators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending validators
            </CardTitle>
            <CardDescription>Upcoming staking activations (not slashing — Titan has no public slash feed yet)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.pendingValidators.map((p) => (
              <div key={`${p.nodeID}-${p.startTime}`} className="flex flex-wrap justify-between gap-2 border-b border-dashed py-2 last:border-0">
                <span className="font-semibold">{validatorLabel(p)}</span>
                <span className="text-muted-foreground">
                  {p.stakeTitan.toLocaleString()} TITAN · starts {formatUnix(p.startTime)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.errors?.length ? (
        <p className="text-xs text-amber-600">{data.errors.join(" · ")}</p>
      ) : null}
    </div>
  );
}

function MiniStat({ title, value }: { title: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}