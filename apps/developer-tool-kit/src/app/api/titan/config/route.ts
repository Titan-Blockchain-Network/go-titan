import { NextRequest, NextResponse } from "next/server";

import { getTitanEcosystemConfig } from "@/lib/titan/ecosystem-config";
import { discoverTitanNodes, getTitanPublicConfig } from "@/lib/titan/network-config";
import { getTitanHomePath } from "@/lib/titan/nav";
import { getRegistryNodes } from "@/lib/titan/node-registry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const config = getTitanPublicConfig(origin);
  const ecosystem = getTitanEcosystemConfig();
  const nodes = await discoverTitanNodes();

  return NextResponse.json({
    networkName: config.networkName,
    networkId: config.networkId,
    chainIdDec: config.chainIdDec,
    chainIdHex: config.chainIdHex,
    rpcUrl: config.rpcUrl,
    bootstrapUrl: config.bootstrapUrl,
    scheme: config.scheme,
    explorerUrl: `${origin}/dashboard/activity`,
    dashboardUrl: `${origin}${getTitanHomePath(config)}`,
    homePath: getTitanHomePath(config),
    isLocalDev: config.isLocalDev,
    logsEnabled: config.logsEnabled,
    ecosystem: {
      launchpadUrl: `${origin}/dashboard/ecosystem`,
      statusApiUrl: `${origin}/api/titan/status`,
      chessAppUrl: ecosystem.chessAppUrl,
      chessEscrowAddress: ecosystem.chessEscrowAddress,
      docsRepoUrl: ecosystem.docsRepoUrl,
    },
    discovery: "Single bootstrap node from TITAN_NETWORK_HOST (or TITAN_BOOTSTRAP_URL).",
    nodeRegistry: getRegistryNodes(),
    nodes: nodes.map((n) => ({
      node: n.node,
      nodeId: n.nodeId,
      host: n.host,
      port: n.port,
      displayUrl: n.displayUrl,
      source: n.source,
      cChainRpc: `${n.rpc}/ext/bc/C/rpc`,
    })),
  });
}