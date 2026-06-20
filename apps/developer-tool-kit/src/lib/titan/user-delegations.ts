import { isAddress } from "viem";

import { cAddressToPChainAddress, resolveNetworkHrp } from "@/lib/titan/p-chain-address";
import { getPrimaryNodeBaseUrl, nanoToTitan, platformRpc } from "@/lib/titan/platform-rpc";
import { enrichNodeFields } from "@/lib/titan/node-registry";
import { Context } from "@flarenetwork/flarejs";

const MAX_VALIDATOR_WEIGHT_FACTOR = 15;
const MAX_VALIDATOR_TOTAL_TITAN = 10_000;

interface PlatformOwner {
  addresses?: string[];
}

interface PlatformDelegator {
  txID?: string;
  startTime?: string;
  endTime?: string;
  weight?: string;
  nodeID?: string;
  rewardOwner?: PlatformOwner;
  potentialReward?: string;
}

interface PlatformValidatorSummary {
  nodeID?: string;
  weight?: string;
  endTime?: string;
  delegatorCount?: string;
  delegatorWeight?: string;
}

interface PlatformValidatorDetail extends PlatformValidatorSummary {
  delegators?: PlatformDelegator[];
}

export interface UserDelegation {
  txID: string;
  nodeID: string;
  validatorName: string;
  stakeTitan: number;
  startTime: number;
  endTime: number;
  potentialRewardTitan: number;
  rewardAddress: string;
  status: "active" | "pending" | "ended";
}

export function maxDelegateDaysForValidator(endTime: number | null, nowSec = Math.floor(Date.now() / 1000)): number {
  if (!endTime) return 365;
  const start = nowSec + 60;
  const secondsLeft = endTime - start;
  if (secondsLeft <= 0) return 0;
  return Math.floor(secondsLeft / 86_400);
}

export function remainingDelegationCapacityTitan(
  validatorStakeTitan: number,
  delegatorWeightTitan: number,
): number {
  const maxTotal = Math.min(validatorStakeTitan * MAX_VALIDATOR_WEIGHT_FACTOR, MAX_VALIDATOR_TOTAL_TITAN);
  const currentTotal = validatorStakeTitan + delegatorWeightTitan;
  return Math.max(0, maxTotal - currentTotal);
}

export function canAcceptDelegators(
  validatorStakeTitan: number,
  delegatorWeightTitan: number,
): boolean {
  return remainingDelegationCapacityTitan(validatorStakeTitan, delegatorWeightTitan) > 0;
}

function delegationStatus(startTime: number, endTime: number, nowSec = Math.floor(Date.now() / 1000)) {
  if (nowSec >= endTime) return "ended" as const;
  if (nowSec < startTime) return "pending" as const;
  return "active" as const;
}

function ownerIncludesAddress(owner: PlatformOwner | undefined, pAddress: string): boolean {
  return (owner?.addresses ?? []).some((a) => a === pAddress);
}

export async function getUserDelegations(
  cAddress: string,
  baseUrl?: string,
): Promise<{
  pAddress: string;
  totalStakedTitan: number;
  delegations: UserDelegation[];
}> {
  if (!isAddress(cAddress)) {
    throw new Error("Invalid C-chain address");
  }

  const rpcBase = baseUrl ?? (await getPrimaryNodeBaseUrl());
  const rawContext = await Context.getContextFromURI(rpcBase);
  const hrp = resolveNetworkHrp(rawContext.networkID, rawContext.hrp);
  const pAddress = cAddressToPChainAddress(cAddress, hrp);

  const [stakeReply, validatorList] = await Promise.all([
    platformRpc<{ staked?: string }>(
      "platform.getStake",
      { addresses: [pAddress], validatorsOnly: false },
      rpcBase,
    ),
    platformRpc<{ validators?: PlatformValidatorSummary[] }>(
      "platform.getCurrentValidators",
      {},
      rpcBase,
    ),
  ]);

  const validatorsWithDelegators = (validatorList.validators ?? []).filter(
    (v) => v.nodeID && Number(v.delegatorCount ?? 0) > 0,
  );

  const detailResults = await Promise.all(
    validatorsWithDelegators.map((v) =>
      platformRpc<{ validators?: PlatformValidatorDetail[] }>(
        "platform.getCurrentValidators",
        { nodeIDs: [v.nodeID] },
        rpcBase,
      ),
    ),
  );

  const delegations: UserDelegation[] = [];

  for (const detail of detailResults) {
    const validator = detail.validators?.[0];
    if (!validator?.nodeID) continue;

    const registry = enrichNodeFields({
      nodeId: validator.nodeID,
      fallback: validator.nodeID.replace(/^NodeID-/, "").slice(0, 12),
    });

    for (const d of validator.delegators ?? []) {
      if (!ownerIncludesAddress(d.rewardOwner, pAddress)) continue;

      const startTime = d.startTime ? Number.parseInt(d.startTime, 10) : 0;
      const endTime = d.endTime ? Number.parseInt(d.endTime, 10) : 0;

      delegations.push({
        txID: d.txID ?? "—",
        nodeID: validator.nodeID,
        validatorName: registry.displayName,
        stakeTitan: nanoToTitan(d.weight),
        startTime,
        endTime,
        potentialRewardTitan: nanoToTitan(d.potentialReward),
        rewardAddress: d.rewardOwner?.addresses?.[0] ?? pAddress,
        status: delegationStatus(startTime, endTime),
      });
    }
  }

  delegations.sort((a, b) => b.startTime - a.startTime);

  return {
    pAddress,
    totalStakedTitan: nanoToTitan(stakeReply.staked),
    delegations,
  };
}