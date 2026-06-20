"use client";

import { useState } from "react";
import { Copy, ShieldCheck, Wallet } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { shortAddress } from "@/lib/titan/format";
import { useTitanConfig } from "@/lib/titan/use-titan-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isOnTitanChain, isWalletConnected, useWalletStore } from "@/stores/wallet/wallet-store";

export function DeveloperConnection() {
  const titan = useTitanConfig();
  const [copiedField, setCopiedField] = useState("");
  const address = useWalletStore((s) => s.address);
  const walletChainId = useWalletStore((s) => s.chainId);
  const titanBalance = useWalletStore((s) => s.titanBalance);
  const signMessage = useWalletStore((s) => s.signMessage);
  const walletError = useWalletStore((s) => s.error);
  const connected = isWalletConnected({ address });

  const endpoints = [
    { key: "rpc", label: "RPC URL", value: titan.rpcUrl },
    { key: "chain", label: "Chain / Network", value: `${titan.chainIdDec} (${titan.chainIdHex}) / ${APP_CONFIG.titan.networkId}`, mono: true },
    {
      key: "token",
      label: "Native token",
      value: `${APP_CONFIG.titan.nativeToken.name} (${APP_CONFIG.titan.nativeToken.symbol}) · ${APP_CONFIG.titan.nativeToken.decimals} decimals`,
      mono: true,
    },
  ];

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Developer Connection</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          MetaMask and tooling endpoints for {titan.networkName}. Connect your wallet from the sidebar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Network endpoints</CardTitle>
            <Badge variant="secondary">MetaMask ready</Badge>
          </div>
          <CardDescription>
            Add Titan to MetaMask with these values, then use Contract Studio or deploy from your own stack.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {endpoints.map((item) => (
              <div key={item.key} className="rounded-md border p-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">{item.label}</p>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <p className={item.mono ? "font-mono text-xs break-all" : "break-all"}>{item.value}</p>
                  {item.key !== "chain" && item.key !== "token" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => copyValue(item.key, item.value)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {copiedField && (
            <p className="text-xs text-muted-foreground">Copied {copiedField} to clipboard.</p>
          )}

          {connected ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium text-emerald-600">
                <Wallet className="size-4" />
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
                {isOnTitanChain(walletChainId) ? titan.networkName : `Chain ${walletChainId}`}
              </p>
              {signMessage && (
                <p className="flex items-center gap-1 pt-1 text-emerald-600">
                  <ShieldCheck className="size-4" /> {signMessage}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Use <strong>Connect MetaMask</strong> in the sidebar to sign transactions on Titan.
            </p>
          )}
          {walletError && !connected && (
            <p className="text-sm text-destructive break-all">{walletError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}