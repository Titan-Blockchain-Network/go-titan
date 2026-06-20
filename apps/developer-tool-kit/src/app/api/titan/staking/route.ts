import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { buildValidatorAddressLabels } from "@/lib/titan/address-labels";
import { cAddressToPChainAddress, resolveNetworkHrp } from "@/lib/titan/p-chain-address";
import { getPrimaryNodeBaseUrl, nanoToTitan, platformRpc } from "@/lib/titan/platform-rpc";
import { getPChainBalance } from "@/lib/titan/staking-tx-build";
import { enrichNodeFields } from "@/lib/titan/node-registry";
import { Context } from "@flarenetwork/flarejs";

export const dynamic = "force-dynamic";

interface PlatformValidator {
  nodeID?: string;
  weight?: string;
  startTime?: string;
  endTime?: string;
  uptime?: string;
  connected?: boolean;
  delegationFee?: string;
  potentialReward?: string;
  validationRewardOwner?: { addresses?: string[] };
  delegationRewardOwner?: { addresses?: string[] };
}

export async function GET(request: NextRequest) {
  try {
    const cAddress = request.nextUrl.searchParams.get("cAddress")?.trim();

    const baseUrl = await getPrimaryNodeBaseUrl();
    const rawContext = await Context.getContextFromURI(baseUrl);
    const hrp = resolveNetworkHrp(rawContext.networkID, rawContext.hrp);
    const context = hrp === rawContext.hrp ? rawContext : { ...rawContext, hrp };

    const [minStake, currentValidators] = await Promise.all([
      platformRpc<{ minValidatorStake?: string; minDelegatorStake?: string }>(
        "platform.getMinStake",
        { subnetID: "11111111111111111111111111111111LpoYY" },
        baseUrl,
      ),
      platformRpc<{ validators?: PlatformValidator[] }>(
        "platform.getCurrentValidators",
        {},
        baseUrl,
      ),
    ]);

    const validators = (currentValidators.validators ?? []).map((v) => {
      const registry = enrichNodeFields({
        nodeId: v.nodeID,
        fallback: v.nodeID?.replace(/^NodeID-/, "").slice(0, 12),
      });
      const rewardAddresses = new Set<string>();
      for (const owner of [v.validationRewardOwner, v.delegationRewardOwner]) {
        for (const a of owner?.addresses ?? []) {
          if (a?.startsWith("0x")) rewardAddresses.add(a);
        }
      }

      return {
        nodeID: v.nodeID ?? "—",
        displayName: registry.displayName,
        stakeTitan: nanoToTitan(v.weight),
        uptimePercent:
          v.uptime != null
            ? Number.parseFloat(v.uptime) <= 1
              ? Number.parseFloat(v.uptime) * 100
              : Number.parseFloat(v.uptime)
            : null,
        connected: v.connected ?? null,
        delegationFeePercent: v.delegationFee
          ? Number.parseFloat(v.delegationFee) / 10_000
          : null,
        potentialRewardTitan: nanoToTitan(v.potentialReward),
        endTime: v.endTime ? Number.parseInt(v.endTime, 10) : null,
        rewardAddresses: [...rewardAddresses],
      };
    });

    const addressLabels = buildValidatorAddressLabels(
      validators.map((v) => ({
        nodeID: v.nodeID,
        name: v.displayName,
        rewardAddresses: v.rewardAddresses,
      })),
    );

    let wallet: Awaited<ReturnType<typeof getPChainBalance>> | null = null;
    if (cAddress && isAddress(cAddress)) {
      wallet = await getPChainBalance(cAddress);
    } else if (cAddress) {
      return NextResponse.json({ error: "Invalid cAddress" }, { status: 400 });
    }

    return NextResponse.json({
      hrp: context.hrp,
      minValidatorStakeTitan: nanoToTitan(minStake.minValidatorStake),
      minDelegatorStakeTitan: nanoToTitan(minStake.minDelegatorStake),
      minDelegationDays: 1,
      maxDelegationDays: 365,
      validatorCount: validators.length,
      validators,
      addressLabels,
      wallet,
      derivedPAddress:
        cAddress && isAddress(cAddress)
          ? cAddressToPChainAddress(cAddress, context.hrp)
          : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load staking data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}