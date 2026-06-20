import { NextResponse } from "next/server";

import { getTitanEcosystemConfig } from "@/lib/titan/ecosystem-config";
import { getNetworkMeshSnapshot } from "@/lib/titan/network-mesh-snapshot";
import { getTitanPublicConfig } from "@/lib/titan/network-config";

export const dynamic = "force-dynamic";

/** Public JSON health endpoint for uptime monitors and CI. */
export async function GET() {
  const config = getTitanPublicConfig("https://explorer.titan-network.xyz");
  const ecosystem = getTitanEcosystemConfig();

  try {
    const network = await getNetworkMeshSnapshot();
    const status = network.healthy && Number(network.blockNumber) > 0 ? "operational" : "degraded";

    return NextResponse.json(
      {
        status,
        network: config.networkName,
        chainId: config.chainIdDec,
        block: network.blockNumber,
        validators: network.validatorsInMesh,
        meshPeers: network.meshPeerCount,
        rpc: config.rpcUrl,
        chessEscrow: ecosystem.chessEscrowAddress,
        checkedAt: new Date().toISOString(),
      },
      {
        headers: {
          "cache-control": "public, max-age=15, s-maxage=15",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "outage",
        error: error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}