import type { Abi } from "viem";

import { CONTRACT_TEMPLATES } from "@/lib/titan/contract-templates";
import type { DeployedContractRecord } from "@/lib/titan/deployed-contracts-storage";

export type SandboxTemplateId = "greeter" | "counter" | "simple-storage" | "titan-chess-escrow";

export const SANDBOX_ABIS: Record<SandboxTemplateId, Abi> = {
  greeter: [
    {
      type: "function",
      name: "greet",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "string" }],
    },
    {
      type: "function",
      name: "setGreeting",
      stateMutability: "nonpayable",
      inputs: [{ name: "_greeting", type: "string" }],
      outputs: [],
    },
  ],
  counter: [
    {
      type: "function",
      name: "count",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      type: "function",
      name: "increment",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "decrement",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
  ],
  "simple-storage": [
    {
      type: "function",
      name: "get",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      type: "function",
      name: "set",
      stateMutability: "nonpayable",
      inputs: [{ name: "value", type: "uint256" }],
      outputs: [],
    },
  ],
  "titan-chess-escrow": [
    {
      type: "function",
      name: "owner",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "address" }],
    },
    {
      type: "function",
      name: "stockfishOperator",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "address" }],
    },
    {
      type: "function",
      name: "houseBankroll",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "queueLength",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "activeGames",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "minStake",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "maxStake",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "depositHouse",
      stateMutability: "payable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "startNextMatch",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "nextGameId",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "getGame",
      stateMutability: "view",
      inputs: [{ name: "gameId", type: "uint256" }],
      outputs: [
        { name: "player", type: "address" },
        { name: "playerStake", type: "uint256" },
        { name: "stockfishStake", type: "uint256" },
        { name: "status", type: "uint8" },
        { name: "outcome", type: "uint8" },
        { name: "winner", type: "address" },
        { name: "startedAt", type: "uint256" },
        { name: "finishedAt", type: "uint256" },
      ],
    },
    {
      type: "function",
      name: "reportResult",
      stateMutability: "nonpayable",
      inputs: [
        { name: "gameId", type: "uint256" },
        { name: "outcome", type: "uint8" },
      ],
      outputs: [],
    },
    {
      type: "function",
      name: "cancelActiveGame",
      stateMutability: "nonpayable",
      inputs: [{ name: "gameId", type: "uint256" }],
      outputs: [],
    },
  ],
};

export function templateIdForContractName(contractName: string): SandboxTemplateId | null {
  const template = CONTRACT_TEMPLATES.find((item) => item.name === contractName);
  if (!template) return null;
  return isSandboxTemplateId(template.id) ? template.id : null;
}

export function resolveSandboxTemplateId(record: DeployedContractRecord): SandboxTemplateId | null {
  if (record.templateId && isSandboxTemplateId(record.templateId)) {
    return record.templateId;
  }
  return templateIdForContractName(record.contractName);
}

export function isSandboxContract(record: DeployedContractRecord): boolean {
  return resolveSandboxTemplateId(record) !== null;
}

export function sandboxLabel(templateId: SandboxTemplateId): string {
  return CONTRACT_TEMPLATES.find((item) => item.id === templateId)?.name ?? templateId;
}

function isSandboxTemplateId(value: string): value is SandboxTemplateId {
  return (
    value === "greeter" ||
    value === "counter" ||
    value === "simple-storage" ||
    value === "titan-chess-escrow"
  );
}