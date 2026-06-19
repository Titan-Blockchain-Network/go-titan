"use client";

import Link from "next/link";

import { ExternalLink } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_CONFIG } from "@/config/app-config";
import { useTitanConfig } from "@/lib/titan/use-titan-config";

export function SidebarSupportCard() {
  const titan = useTitanConfig();

  return (
    <Card size="sm" className="shadow-none group-data-[collapsible=icon]:hidden">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{titan.networkName}</CardTitle>
        <CardDescription>
          Chain ID {titan.chainIdDec} · {APP_CONFIG.titan.nativeToken.symbol}.{" "}
          <Link
            href="/dashboard/activity"
            className="inline-flex items-center gap-0.5 text-foreground underline-offset-4 hover:underline"
          >
            Browse chain
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}