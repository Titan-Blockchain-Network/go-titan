import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { buildValidatorAddressLabels } from "@/lib/titan/address-labels";
import { cAddressToPChainAddress, resolveNetworkHrp } from "@/lib/titan/p-chain-address";
import { getPrimaryNodeBaseUrl, nanoToTitan, platformRpc } from "@/lib/titan/platform-rpc";
import { countPendingImportUtxos, getPChainBalance } from "@/lib/titan/staking-tx-build";
import {
  canAcceptDelegators,
  getUserDelegations,
  maxDelegateDaysForValidator,
  remainingDelegationCapacityTitan,
  type UserDelegation,
} from "@/lib/titan/user-delegations";
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
  delegatorCount?: string;
  delegatorWeight?: string;
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

      const stakeTitan = nanoToTitan(v.weight);
      const delegatorWeightTitan = nanoToTitan(v.delegatorWeight);
      const delegatorCount = Number(v.delegatorCount ?? 0);
      const endTime = v.endTime ? Number.parseInt(v.endTime, 10) : null;

      return {
        nodeID: v.nodeID ?? "—",
        displayName: registry.displayName,
        stakeTitan,
        delegatorWeightTitan,
        delegatorCount,
        totalWeightTitan: stakeTitan + delegatorWeightTitan,
        maxDelegateDays: maxDelegateDaysForValidator(endTime),
        canAcceptDelegators: canAcceptDelegators(stakeTitan, delegatorWeightTitan),
        remainingDelegationCapacityTitan: remainingDelegationCapacityTitan(
          stakeTitan,
          delegatorWeightTitan,
        ),
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
        endTime,
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
    let walletError: string | undefined;
    let pendingImportUtxos = 0;
    let userDelegations: UserDelegation[] = [];
    let totalStakedTitan = 0;

    if (cAddress && isAddress(cAddress)) {
      try {
        [wallet, pendingImportUtxos] = await Promise.all([
          getPChainBalance(cAddress),
          countPendingImportUtxos(cAddress),
        ]);
      } catch (walletLookupError) {
        walletError =
          walletLookupError instanceof Error
            ? walletLookupError.message
            : "Failed to load P-chain balance";
        try {
          pendingImportUtxos = await countPendingImportUtxos(cAddress);
        } catch {
          pendingImportUtxos = 0;
        }
      }

      try {
        const delegationSnapshot = await getUserDelegations(cAddress, baseUrl);
        userDelegations = delegationSnapshot.delegations;
        totalStakedTitan = delegationSnapshot.totalStakedTitan;
      } catch (delegationError) {
        walletError = walletError
          ? `${walletError}; ${delegationError instanceof Error ? delegationError.message : "Failed to load delegations"}`
          : delegationError instanceof Error
            ? delegationError.message
            : "Failed to load delegations";
      }
    } else if (cAddress) {
      return NextResponse.json({ error: "Invalid cAddress" }, { status: 400 });
    }

    const globalMaxDelegateDays = validators.reduce(
      (max, v) => Math.max(max, v.maxDelegateDays),
      1,
    );

    return NextResponse.json({
      hrp: context.hrp,
      minValidatorStakeTitan: nanoToTitan(minStake.minValidatorStake),
      minDelegatorStakeTitan: nanoToTitan(minStake.minDelegatorStake),
      minDelegationDays: 1,
      maxDelegationDays: globalMaxDelegateDays,
      validatorCount: validators.length,
      validators,
      addressLabels,
      wallet,
      walletError,
      pendingImportUtxos,
      userDelegations,
      totalStakedTitan,
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