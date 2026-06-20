import Link from "next/link";
import {
  Blocks,
  BookOpen,
  Code2,
  ExternalLink,
  FileJson,
  Gamepad2,
  Radio,
  Rocket,
  Server,
} from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { TITAN_GITHUB_REPO, TITAN_GITHUB_REPO_URL } from "@/lib/titan/origin";

const REPO = TITAN_GITHUB_REPO_URL;

const sections = [
  {
    title: "Getting started",
    items: [
      {
        title: "Developer Connection",
        description: "RPC URL, chain ID, and MetaMask setup for Titan.",
        href: "/dashboard/developers",
        icon: Server,
        internal: true,
      },
      {
        title: "Monorepo on GitHub",
        description: "Explorer, chess app, contracts, and network tooling.",
        href: REPO,
        icon: BookOpen,
        internal: false,
      },
      {
        title: "Network status API",
        description: "Public JSON health endpoint for monitors and CI.",
        href: "/api/titan/status",
        icon: Radio,
        internal: true,
        external: true,
      },
    ],
  },
  {
    title: "Build on Titan",
    items: [
      {
        title: "Contract Studio",
        description: "Compile, deploy, and interact with Solidity on the C-Chain.",
        href: "/dashboard/contracts",
        icon: Code2,
        internal: true,
      },
      {
        title: "Chain Explorer",
        description: "Blocks, transactions, validators, and analytics.",
        href: "/dashboard/activity",
        icon: Blocks,
        internal: true,
      },
      {
        title: "Ecosystem Launchpad",
        description: "Live apps, escrow monitors, and builder quick-start.",
        href: "/dashboard/ecosystem",
        icon: Rocket,
        internal: true,
      },
      {
        title: "Origin manifest",
        description: "Network identity JSON served from the repo.",
        href: "/dashboard/origin",
        icon: FileJson,
        internal: true,
      },
    ],
  },
  {
    title: "Apps",
    items: [
      {
        title: "Titan Chess escrow guide",
        description: "House bankroll model — contract holds funds, operator signs only.",
        href: `${TITAN_GITHUB_REPO}/blob/main/apps/titan-chess/ESCROW_INTEGRATION.md`,
        icon: Gamepad2,
        internal: false,
      },
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="@container/main flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documentation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guides and references for building on {APP_CONFIG.titan.networkName} (chain{" "}
          {APP_CONFIG.titan.chainIdDec}).
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.items.map((item) => {
              const Icon = item.icon;
              const card = (
                <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/20">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex size-9 items-center justify-center rounded-lg border bg-muted/50">
                        <Icon className="size-4 text-primary" />
                      </div>
                      {!item.internal && <Badge variant="outline">External</Badge>}
                    </div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      Open
                      <ExternalLink className="size-3 opacity-70" />
                    </span>
                  </CardContent>
                </Card>
              );

              if (item.internal && !item.external) {
                return (
                  <Link key={item.title} href={item.href} className="block">
                    {card}
                  </Link>
                );
              }

              return (
                <a
                  key={item.title}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  {card}
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}