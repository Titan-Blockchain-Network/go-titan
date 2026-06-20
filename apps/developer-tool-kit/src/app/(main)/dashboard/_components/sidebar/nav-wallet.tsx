"use client";

import { Copy, EllipsisVertical, Loader2, LogOut, RefreshCw, Wallet } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { shortAddress } from "@/lib/titan/format";
import { walletKindLabel } from "@/lib/titan/wallet-providers";
import { cn } from "@/lib/utils";
import { isOnTitanChain, useWalletStore } from "@/stores/wallet/wallet-store";

export function NavWallet() {
  const { isMobile } = useSidebar();
  const address = useWalletStore((s) => s.address);
  const chainId = useWalletStore((s) => s.chainId);
  const walletKind = useWalletStore((s) => s.walletKind);
  const coreInstalled = useWalletStore((s) => s.coreInstalled);
  const coreAddress = useWalletStore((s) => s.coreAddress);
  const titanBalance = useWalletStore((s) => s.titanBalance);
  const isLoading = useWalletStore((s) => s.isLoading);
  const isRefreshingBalance = useWalletStore((s) => s.isRefreshingBalance);
  const error = useWalletStore((s) => s.error);
  const connect = useWalletStore((s) => s.connect);
  const disconnect = useWalletStore((s) => s.disconnect);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);

  async function handleCopyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard unavailable.
    }
  }

  if (!address) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="default"
                disabled={isLoading}
                className="cursor-pointer data-[state=open]:bg-sidebar-accent"
                tooltip="Connect wallet"
              >
                {isLoading ? <Loader2 className="animate-spin" /> : <Wallet />}
                <span className="truncate font-medium group-data-[collapsible=icon]:hidden">
                  Connect wallet
                </span>
                <span className="truncate text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
                  {error || `MetaMask or Core · ${APP_CONFIG.titan.networkName}`}
                </span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel>Connect to Titan</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void connect("metamask")} disabled={isLoading}>
                <Wallet />
                MetaMask (C-chain)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void connect("core")} disabled={isLoading}>
                <Wallet />
                Avalanche Core (C-chain + P-chain)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                Core extension: {coreInstalled ? "detected" : "not detected"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const onTitanChain = isOnTitanChain(chainId);
  const connectedLabel = walletKindLabel(walletKind);
  const walletTooltip = `${connectedLabel} · ${shortAddress(address)} · ${titanBalance} ${APP_CONFIG.titan.nativeToken.symbol}`;
  const coreMatches =
    coreAddress && address
      ? coreAddress.toLowerCase() === address.toLowerCase()
      : null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="default"
              tooltip={walletTooltip}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Wallet className="text-emerald-600 dark:text-emerald-400" />
              <span className="truncate font-medium font-mono group-data-[collapsible=icon]:hidden">
                {shortAddress(address)}
              </span>
              <span className="truncate text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
                {isRefreshingBalance ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  <>
                    {connectedLabel} · {titanBalance} {APP_CONFIG.titan.nativeToken.symbol}
                  </>
                )}
              </span>
              <EllipsisVertical className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
                  <Wallet className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{connectedLabel}</span>
                  <span className="truncate font-mono text-xs">{shortAddress(address)}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {titanBalance} {APP_CONFIG.titan.nativeToken.symbol}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleCopyAddress}>
              <Copy />
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void refreshBalance()} disabled={isRefreshingBalance}>
              <RefreshCw className={cn(isRefreshingBalance && "animate-spin")} />
              Refresh balance
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs">
              C-chain: {connectedLabel}
              {onTitanChain ? ` · ${APP_CONFIG.titan.networkName}` : ` · chain ${chainId}`}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled
              className={cn(
                "text-xs",
                coreInstalled
                  ? coreMatches === false
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              Core:{" "}
              {coreInstalled
                ? coreAddress
                  ? coreMatches
                    ? `ready · ${shortAddress(coreAddress)}`
                    : `different account · ${shortAddress(coreAddress)}`
                  : "installed — unlock & authorize on this site"
                : "extension not detected"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void connect("metamask")} disabled={isLoading}>
              Switch to MetaMask
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void connect("core")} disabled={isLoading}>
              Switch to Core
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={disconnect}>
              <LogOut />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}