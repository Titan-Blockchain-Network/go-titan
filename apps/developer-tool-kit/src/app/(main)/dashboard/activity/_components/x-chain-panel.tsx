"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Layers, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface XChainSnapshot {
  height: number | null;
  bootstrapped: boolean | null;
  error?: string;
}

async function xRpc<T>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch("/api/titan/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, chain: "X" }),
  });
  const j = await res.json();
  if (j?.error) {
    const msg = typeof j.error === "string" ? j.error : j.error?.message || JSON.stringify(j.error);
    throw new Error(msg);
  }
  return j?.result as T;
}

export function XChainPanel() {
  const [snapshot, setSnapshot] = useState<XChainSnapshot>({
    height: null,
    bootstrapped: null,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [heightRes, bootRes] = await Promise.allSettled([
        xRpc<{ height?: string }>("avm.getHeight"),
        fetch("/api/titan/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: "info.isBootstrapped",
            params: { chain: "X" },
            chain: "INFO",
          }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j?.error) throw new Error(j.error.message ?? "bootstrap check failed");
            return j.result as { isBootstrapped?: boolean };
          }),
      ]);

      const height =
        heightRes.status === "fulfilled" && heightRes.value?.height
          ? Number.parseInt(heightRes.value.height, 10)
          : null;
      const bootstrapped =
        bootRes.status === "fulfilled" ? Boolean(bootRes.value?.isBootstrapped) : null;

      setSnapshot({ height, bootstrapped });
    } catch (e) {
      setSnapshot({
        height: null,
        bootstrapped: null,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            X-Chain (Exchange VM)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The X-Chain handles AVM assets and atomic cross-chain transfers. Titan&apos;s primary activity
            lives on the C-Chain; use this view for VM health and height.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase text-muted-foreground">Block height</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (snapshot.height?.toLocaleString() ?? "—")}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase text-muted-foreground">Bootstrap</p>
            <div className="mt-1 flex items-center gap-2">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : snapshot.bootstrapped ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium">Synced</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-amber-500" />
                  <span className="font-medium">Not ready</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">What you can do on X-Chain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Create and transfer AVM assets (native TITAN on X uses the AVAX alias in genesis)</p>
          <p>• Import / export between X and C via atomic transactions</p>
          <p>• Full block explorer for X vertices is not wired in this UI yet — switch to C-Chain for EVM history</p>
          {snapshot.error && <p className="text-xs text-red-500 break-all">{snapshot.error}</p>}
          <Badge variant="outline" className="mt-2">
            API: /ext/bc/X · avm.*
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}